// ── 서버 인가·검증·보안 헤더 E2E (P1/P2/P4) ──
// 실행 중인 서버(시드 계정 3종)에 대해:
//  P1: 메뉴 권한(menu_permissions)이 API/페이지에서 실제로 강제되는지 (접근/쓰기/승인, 설정 변경 즉시 반영, 감사로그)
//  P2: 잘못된 입력이 500 이 아니라 400/JSON 으로 돌아오는지 (enum/JSON/경로 id)
//  P4: nonce CSP 헤더, 세션 TTL 기본 8h, 관리자 행위 감사로그
// 사용: 서버 기동 후  node scripts/verify-authz.mjs   (BASE_URL 로 대상 오버라이드). 테스트 후 권한 기본값을 복원한다.
import { createHash } from "crypto";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const sha512 = (s) => createHash("sha512").update(s).digest("hex");
let failures = 0;
const ok = (n) => console.log(`  ✓ ${n}`);
const fail = (n, d) => { failures++; console.error(`  ✗ ${n} — ${d}`); };
const assert = (c, n, d = "") => (c ? ok(n) : fail(n, d));
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})), headers: r.headers });

async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: sha512(password) }),
  });
  if (!r.ok) throw new Error(`login ${username} → ${r.status}`);
  return { Cookie: (r.headers.get("set-cookie") || "").split(";")[0], "Content-Type": "application/json" };
}

async function getPerms(admin, role) {
  return (await j(await fetch(`${BASE}/api/permissions?role=${role}`, { headers: admin }))).body;
}
async function putPerms(admin, role, permissions) {
  return j(await fetch(`${BASE}/api/permissions`, { method: "PUT", headers: admin, body: JSON.stringify({ role, permissions }) }));
}
function withMenu(perms, key, patch) {
  return perms.map((p) => (p.menu_key === key ? { ...p, ...patch } : p));
}

async function main() {
  console.log(`── verify-authz: ${BASE} ──`);
  const admin = await login("admin@example.go.kr", "admin123");
  const team = await login("user@example.go.kr", "user123");
  const viewer = await login("viewer@example.go.kr", "viewer123");
  ok("3역할 로그인");

  // 시드의 team 계정은 팀 미배정 → 팀 쓰기 검증이 의미 있도록 첫 팀에 배정(끝나면 원복)
  const users = (await j(await fetch(`${BASE}/api/users`, { headers: admin }))).body;
  const teamUser = (Array.isArray(users) ? users : users.rows || []).find((u) => u.username === "user@example.go.kr");
  let teams = (await j(await fetch(`${BASE}/api/teams`, { headers: admin }))).body;
  let createdTeamId = null;
  if (Array.isArray(teams) && teams.length === 0) {
    // 시드에 팀이 없으면 검증용 팀을 만든다(끝나면 삭제)
    const t = await j(await fetch(`${BASE}/api/teams`, { method: "POST", headers: admin, body: JSON.stringify({ team_name: "E2E-검증팀" }) }));
    createdTeamId = t.body?.id ?? null;
    teams = (await j(await fetch(`${BASE}/api/teams`, { headers: admin }))).body;
  }
  const firstTeam = Array.isArray(teams) ? teams[0] : undefined;
  const originalTeamId = teamUser?.team_id ?? null;
  if (teamUser && firstTeam && originalTeamId == null) {
    const u = await j(await fetch(`${BASE}/api/users/${teamUser.id}`, { method: "PUT", headers: admin, body: JSON.stringify({ display_name: teamUser.display_name, role: "team", team_id: firstTeam.id, is_active: 1 }) }));
    assert(u.status === 200, `team 계정을 팀 '${firstTeam.team_name}' 에 배정`, `${u.status} ${JSON.stringify(u.body)}`);
  }
  const restoreTeamUser = async () => {
    if (teamUser && firstTeam && originalTeamId == null) {
      await fetch(`${BASE}/api/users/${teamUser.id}`, { method: "PUT", headers: admin, body: JSON.stringify({ display_name: teamUser.display_name, role: "team", team_id: null, is_active: 1 }) });
    }
    if (createdTeamId) await fetch(`${BASE}/api/teams/${createdTeamId}`, { method: "DELETE", headers: admin });
  };

  const teamDefaults = await getPerms(admin, "team");
  assert(Array.isArray(teamDefaults) && teamDefaults.some((p) => p.menu_key === "contracts" && p.can_access === 0), "team 기본 권한: 계약관리 접근 0 (레지스트리 시드)", JSON.stringify(teamDefaults));

  // ── P1: 접근 권한 서버 강제 ──
  let r = await j(await fetch(`${BASE}/api/contracts`, { headers: team }));
  assert(r.status === 403 && /계약관리/.test(r.body.error || ""), "team GET /api/contracts → 403 (메뉴 접근 없음)", `${r.status} ${JSON.stringify(r.body)}`);
  const pageRes = await fetch(`${BASE}/contracts`, { headers: { Cookie: team.Cookie }, redirect: "manual" });
  assert([302, 307].includes(pageRes.status) && /\/access-denied\?menu=contracts/.test(pageRes.headers.get("location") || ""), "team /contracts 페이지 → /access-denied 리다이렉트", `${pageRes.status} ${pageRes.headers.get("location")}`);
  const deniedHtml = await (await fetch(`${BASE}/access-denied?menu=contracts`, { headers: { Cookie: team.Cookie } })).text();
  assert(deniedHtml.includes("계약관리") && deniedHtml.includes("접근 권한이 없습니다"), "access-denied 페이지가 메뉴명을 표시", "");
  r = await j(await fetch(`${BASE}/api/vendors`, { headers: team }));
  assert(r.status === 403, "team GET /api/vendors → 403 (계약관리 귀속 API 동일 차단)", `${r.status}`);

  // 권한 열기 → 즉시 반영
  let put = await putPerms(admin, "team", withMenu(teamDefaults, "contracts", { can_access: 1, can_write: 1 }));
  assert(put.status === 200, "총괄이 team 계약관리 접근+쓰기 허용", `${put.status}`);
  r = await j(await fetch(`${BASE}/api/contracts`, { headers: team }));
  assert(r.status === 200 && Array.isArray(r.body), "권한 부여 직후 team GET /api/contracts → 200 (재로그인 불필요)", `${r.status}`);
  r = await j(await fetch(`${BASE}/api/contracts`, { method: "POST", headers: team, body: JSON.stringify({ contract_name: "E2E 권한검증 계약", contract_type: "maintenance", start_date: "2026-01-01", end_date: "2026-12-31" }) }));
  assert(r.status === 201 && r.body.id > 0, "쓰기 허용 후 team POST /api/contracts → 201", `${r.status} ${JSON.stringify(r.body)}`);
  const contractId = r.body.id;

  // 쓰기만 끄기 → 읽기 OK, 쓰기 403
  put = await putPerms(admin, "team", withMenu(teamDefaults, "contracts", { can_access: 1, can_write: 0 }));
  r = await j(await fetch(`${BASE}/api/contracts`, { method: "POST", headers: team, body: JSON.stringify({ contract_name: "E2E 차단" }) }));
  assert(r.status === 403 && /쓰기 권한/.test(r.body.error || ""), "쓰기 해제 후 team POST → 403 '쓰기 권한 없음'", `${r.status} ${JSON.stringify(r.body)}`);
  r = await j(await fetch(`${BASE}/api/contracts`, { headers: team }));
  assert(r.status === 200, "쓰기 해제해도 읽기는 200", `${r.status}`);
  r = await j(await fetch(`${BASE}/api/contracts/${contractId}`, { method: "DELETE", headers: team }));
  assert(r.status === 403, "쓰기 해제 후 team DELETE → 403", `${r.status}`);

  // 기본값 복원 + 정리
  put = await putPerms(admin, "team", teamDefaults);
  assert(put.status === 200, "team 권한 기본값 복원", `${put.status}`);
  r = await j(await fetch(`${BASE}/api/contracts/${contractId}`, { method: "DELETE", headers: admin }));
  assert(r.status === 200, "총괄이 E2E 계약 정리", `${r.status}`);

  // viewer: 역할 자체가 쓰기 불가 + 메뉴 쓰기 0 → 자산 등록 403
  r = await j(await fetch(`${BASE}/api/assets`, { method: "POST", headers: viewer, body: JSON.stringify({ asset_type: "server", asset_name: "E2E-viewer" }) }));
  assert(r.status === 403, "viewer POST /api/assets → 403", `${r.status} ${JSON.stringify(r.body)}`);
  r = await j(await fetch(`${BASE}/api/frames`, { headers: viewer }));
  assert(r.status === 403 && /배선관리/.test(r.body.error || ""), "viewer GET /api/frames → 403 (배선관리 기본 접근 0)", `${r.status} ${JSON.stringify(r.body)}`);

  // 승인 권한: team 은 movements can_approve=0 → 승인 403 (자기 팀 자산 연결 신청이라도)
  r = await j(await fetch(`${BASE}/api/assets?limit=1`, { headers: team }));
  const teamAsset = r.body?.rows?.[0];
  if (teamAsset) {
    r = await j(await fetch(`${BASE}/api/movements`, { method: "POST", headers: team, body: JSON.stringify({ movement_type: "bring_out", asset_id: teamAsset.id, movement_date: "2026-09-11", purpose: "E2E 승인권한" }) }));
    assert(r.status === 201, "team 반출 신청 201", `${r.status} ${JSON.stringify(r.body)}`);
    const mvId = r.body.id;
    r = await j(await fetch(`${BASE}/api/movements/${mvId}`, { method: "PUT", headers: team, body: JSON.stringify({ status: "approved" }) }));
    assert(r.status === 403 && /승인 권한/.test(r.body.error || ""), "team 승인 시도 → 403 '승인 권한 없음'", `${r.status} ${JSON.stringify(r.body)}`);
    r = await j(await fetch(`${BASE}/api/movements/${mvId}`, { method: "PUT", headers: admin, body: JSON.stringify({ status: "rejected" }) }));
    assert(r.status === 200 && r.body.status === "rejected", "총괄 반려 200", `${r.status}`);
    await fetch(`${BASE}/api/movements/${mvId}`, { method: "DELETE", headers: admin });
  } else {
    ok("(team 가시 자산 없음 — 승인 권한 검증은 건너뜀)");
  }

  // ── P2: 입력 검증 → 400 (500 아님) ──
  r = await j(await fetch(`${BASE}/api/movements`, { method: "POST", headers: admin, body: JSON.stringify({ movement_type: "teleport" }) }));
  assert(r.status === 400 && /허용/.test(r.body.error || ""), "잘못된 movement_type → 400 + 허용값 안내", `${r.status} ${JSON.stringify(r.body)}`);
  r = await j(await fetch(`${BASE}/api/assets`, { method: "POST", headers: admin, body: JSON.stringify({ asset_type: "server", asset_name: "x", status: "eos" }) }));
  assert(r.status === 400 && /상태/.test(r.body.error || ""), "잘못된 asset status → 400", `${r.status} ${JSON.stringify(r.body)}`);
  r = await j(await fetch(`${BASE}/api/assets`, { method: "POST", headers: admin, body: "{not json" }));
  assert(r.status === 400 && /JSON/.test(r.body.error || ""), "깨진 JSON 본문 → 400", `${r.status} ${JSON.stringify(r.body)}`);
  r = await j(await fetch(`${BASE}/api/assets/abc`, { headers: admin }));
  assert(r.status === 400, "경로 id 'abc' → 400", `${r.status}`);
  r = await j(await fetch(`${BASE}/api/contracts`, { method: "POST", headers: admin, body: JSON.stringify({ contract_name: "x", start_date: "미상" }) }));
  assert(r.status === 400 && /YYYY-MM-DD/.test(r.body.error || ""), "해석 불가 날짜 → 400", `${r.status} ${JSON.stringify(r.body)}`);
  // 레거시 표기(점 구분)는 정규화되어 통과하고 저장값은 YYYY-MM-DD (비평 HIGH 반영)
  r = await j(await fetch(`${BASE}/api/contracts`, { method: "POST", headers: admin, body: JSON.stringify({ contract_name: "E2E 날짜정규화", start_date: "2026.01.05", end_date: "45123" }) }));
  assert(r.status === 201 && r.body.start_date === "2026-01-05" && r.body.end_date === "2023-07-16", "레이시 날짜 표기(점/엑셀 일련번호) 정규화 저장", `${r.status} ${JSON.stringify(r.body)}`);
  if (r.body?.id) await fetch(`${BASE}/api/contracts/${r.body.id}`, { method: "DELETE", headers: admin });
  r = await j(await fetch(`${BASE}/api/permissions`, { method: "PUT", headers: admin, body: JSON.stringify({ role: "team", permissions: [{ menu_key: "portmap", can_access: 1 }] }) }));
  assert(r.status === 400 && /메뉴 키/.test(r.body.error || ""), "레지스트리 밖 메뉴 키 저장 → 400", `${r.status} ${JSON.stringify(r.body)}`);
  r = await j(await fetch(`${BASE}/api/teams`, { method: "POST", headers: admin, body: JSON.stringify({ team_name: "" }) }));
  assert(r.status === 400, "빈 팀명 → 400", `${r.status} ${JSON.stringify(r.body)}`);

  // ── P4: 감사로그(관리자 행위) ──
  r = await j(await fetch(`${BASE}/api/audit?entity_type=permission&limit=5`, { headers: admin }));
  const permLog = r.body?.logs?.[0] ?? r.body?.rows?.[0] ?? (Array.isArray(r.body) ? r.body[0] : undefined);
  assert(r.status === 200 && permLog && permLog.entity_name === "team" && permLog.changed_by === "admin@example.go.kr", "권한 변경이 감사로그(entity permission)에 기록", `${r.status} ${JSON.stringify(permLog)}`);
  assert(permLog && (permLog.changed_fields || []).includes("contracts"), "감사로그 changed_fields 에 contracts 포함", JSON.stringify(permLog?.changed_fields));
  r = await j(await fetch(`${BASE}/api/teams`, { method: "POST", headers: admin, body: JSON.stringify({ team_name: "E2E-감사팀" }) }));
  const teamId = r.body?.id;
  assert(r.status === 201 || r.status === 200, "팀 생성", `${r.status}`);
  r = await j(await fetch(`${BASE}/api/audit?entity_type=team&limit=3`, { headers: admin }));
  const teamLog = r.body?.logs?.[0] ?? r.body?.rows?.[0];
  assert(teamLog && teamLog.action === "create" && teamLog.entity_name === "E2E-감사팀", "팀 생성 감사로그", JSON.stringify(teamLog));
  if (teamId) await fetch(`${BASE}/api/teams/${teamId}`, { method: "DELETE", headers: admin });

  // ── P4: CSP nonce + 세션 TTL ──
  const home = await fetch(`${BASE}/`, { headers: { Cookie: admin.Cookie } });
  const csp = home.headers.get("content-security-policy") || "";
  const scriptSrc = (csp.match(/script-src[^;]*/) || [""])[0];
  assert(/nonce-[A-Za-z0-9+/=]+/.test(scriptSrc) && /'strict-dynamic'/.test(scriptSrc) && !/'unsafe-inline'/.test(scriptSrc), "CSP script-src: nonce + strict-dynamic, unsafe-inline 없음", scriptSrc);
  const nonce = (scriptSrc.match(/nonce-([A-Za-z0-9+/=]+)/) || [])[1];
  const html = await home.text();
  assert(nonce && html.includes(`nonce="${nonce}"`), "HTML 인라인 스크립트에 응답 nonce 부착", nonce ? "nonce 미검출" : "nonce 없음");
  const home2 = await fetch(`${BASE}/`, { headers: { Cookie: admin.Cookie } });
  assert((home2.headers.get("content-security-policy") || "") !== csp, "요청마다 nonce 가 달라짐", "");
  const loginPage = await fetch(`${BASE}/login`);
  assert(/nonce-/.test(loginPage.headers.get("content-security-policy") || ""), "/login 도 nonce CSP", "");
  // 정적 프리렌더 회귀 방지 (비평 CRITICAL): 예전에 정적이던 /change-password 와 404 페이지도 응답 nonce 가 스크립트에 붙어야 한다
  for (const p of ["/change-password", "/this-page-does-not-exist"]) {
    const res = await fetch(`${BASE}${p}`, { headers: { Cookie: admin.Cookie } });
    const cspP = res.headers.get("content-security-policy") || "";
    const nonceP = (cspP.match(/nonce-([A-Za-z0-9+/=]+)/) || [])[1];
    const htmlP = await res.text();
    const scriptTags = htmlP.match(/<script\b[^>]*>/g) || [];
    // 실행되는 스크립트 전부(외부 src + 인라인 부트스트랩) nonce 필수. type=application/json 등 비실행 데이터 스크립트만 예외.
    const executable = scriptTags.filter((t) => !/type="(application\/(json|ld\+json)|text\/template)"/.test(t));
    const withoutNonce = executable.filter((t) => !t.includes(`nonce="${nonceP}"`));
    assert(nonceP && executable.length > 0 && withoutNonce.length === 0, `${p}: 실행 스크립트(외부+인라인) 전부에 응답 nonce 부착 (정적 프리렌더 아님)`, `status ${res.status}, script ${scriptTags.length}개, nonce 누락 ${withoutNonce.length}개`);
  }

  r = await j(await fetch(`${BASE}/api/auth/me`, { headers: admin }));
  const ttlH = (r.body.exp - Date.now()) / 3600000;
  const expected = Number(process.env.SESSION_TTL_HOURS) > 0 ? Number(process.env.SESSION_TTL_HOURS) : 8;
  assert(Math.abs(ttlH - expected) < 0.1, `세션 TTL ≈ ${expected}h`, `실측 ${ttlH.toFixed(2)}h`);

  await restoreTeamUser();
  console.log(failures === 0 ? "── PASS ──" : `── FAIL (${failures}) ──`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

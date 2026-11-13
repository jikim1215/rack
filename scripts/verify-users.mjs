// ── 사용자 일괄 등록 · 장기 미사용 비활성화 E2E 검증 ──
// 실행 중인 서버(시드 DB)에 총괄로 로그인해 양식 내려받기 → 검증(dryRun) → 오류 시 무등록 → 등록 → 초기 비밀번호(이메일)
// 로그인·변경 강제, 장기 미사용 점검·비활성화·재활성화를 검사하고, 만든 계정은 지운다.
// 사용: 서버 기동 후  ASSET_DB_PATH=<서버가 쓰는 DB> node scripts/verify-users.mjs   (BASE_URL 로 대상 오버라이드)
//   ASSET_DB_PATH 는 계정의 마지막 활동 시각을 7개월 전으로 돌리는 데만 쓴다(운영 DB 금지).
import { createHash } from "crypto";
import ExcelJS from "exceljs";
import Database from "better-sqlite3";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const DB_PATH = process.env.ASSET_DB_PATH;
const sha512 = (s) => createHash("sha512").update(s).digest("hex");
let failures = 0;
const ok = (n) => console.log(`  ✓ ${n}`);
const fail = (n, d) => { failures++; console.error(`  ✗ ${n} — ${d}`); };
const assert = (c, n, d = "") => (c ? ok(n) : fail(n, d));
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

async function login(username, password) {
  return fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: sha512(password) }),
  });
}
const cookieOf = (r) => ({ Cookie: (r.headers.get("set-cookie") || "").split(";")[0] });

async function xlsx(rows) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("사용자등록").addRows(rows);
  return new Blob([await wb.xlsx.writeBuffer()]);
}
async function upload(headers, rows, dryRun) {
  const fd = new FormData();
  fd.append("file", await xlsx(rows), "users.xlsx");
  if (dryRun) fd.append("dryRun", "1");
  return j(await fetch(`${BASE}/api/users/import`, { method: "POST", headers, body: fd }));
}

async function main() {
  console.log(`── verify-users: ${BASE} ──`);
  const lr = await login("admin@example.go.kr", "admin123");
  if (!lr.ok) throw new Error(`admin login ${lr.status}`);
  const admin = cookieOf(lr);
  const team = cookieOf(await login("user@example.go.kr", "user123"));

  // 총괄 전용
  assert((await fetch(`${BASE}/api/users/import`, { headers: team })).status === 403, "팀 계정 양식 403");
  assert((await fetch(`${BASE}/api/users/inactive`, { headers: team })).status === 403, "팀 계정 장기 미사용 점검 403");

  const tpl = await fetch(`${BASE}/api/users/import`, { headers: admin });
  assert(tpl.status === 200 && (tpl.headers.get("content-type") || "").includes("spreadsheetml"), "양식 내려받기", `status ${tpl.status}`);

  // 팀 하나 확보
  let teams = (await j(await fetch(`${BASE}/api/teams`, { headers: admin }))).body;
  let createdTeam = null;
  if (!Array.isArray(teams) || teams.length === 0) {
    const t = await j(await fetch(`${BASE}/api/teams`, { method: "POST", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify({ team_name: "E2E일괄팀" }) }));
    createdTeam = t.body.id;
    teams = (await j(await fetch(`${BASE}/api/teams`, { headers: admin }))).body;
  }
  const teamName = teams[0].team_name;
  const stamp = Date.now();
  const u1 = `e2e-bulk1-${stamp}@example.go.kr`, u2 = `e2e-bulk2-${stamp}@example.go.kr`;
  const H = ["이메일", "이름", "역할", "팀", "허용IP"];

  // 오류가 섞이면 아무도 등록되지 않는다
  let r = await upload(admin, [H, [u1, "일괄1", "팀", teamName, ""], ["boss@example.go.kr", "", "총괄", "", ""]], false);
  assert(r.status === 400 && r.body.errors?.[0]?.row === 3, "오류 행 포함 → 400 + 행 번호", JSON.stringify(r.body));
  let list = (await j(await fetch(`${BASE}/api/users`, { headers: admin }))).body;
  assert(!list.some((u) => u.username === u1), "오류 시 정상 행도 등록 안 됨");

  // dryRun 은 등록하지 않는다
  const rows = [H, [u1, "일괄1", "팀", teamName, ""], [u2.toUpperCase(), "일괄2", "전체열람", "", "10.0.0.0/8"]];
  r = await upload(admin, rows, true);
  assert(r.status === 200 && r.body.users?.length === 2, "검증(dryRun) 2명", JSON.stringify(r.body));
  list = (await j(await fetch(`${BASE}/api/users`, { headers: admin }))).body;
  assert(!list.some((u) => u.username === u1), "dryRun 은 등록 안 함");

  r = await upload(admin, rows, false);
  assert(r.status === 201 && r.body.inserted === 2, "등록 201 (2명)", JSON.stringify(r.body));
  list = (await j(await fetch(`${BASE}/api/users`, { headers: admin }))).body;
  const c1 = list.find((u) => u.username === u1), c2 = list.find((u) => u.username === u2);
  assert(c1 && c1.role === "team" && c1.team_id === teams[0].id && c1.must_change_password === 1 && c1.last_login_at === null, "팀 계정 생성·변경 강제·로그인 기록 없음", JSON.stringify(c1));
  assert(c2 && c2.role === "viewer" && c2.team_id === null && c2.allowed_ips === "10.0.0.0/8", "열람 계정 소문자 정규화·허용IP", JSON.stringify(c2));
  r = await upload(admin, rows, true);
  assert(r.status === 400 && /이미 등록/.test(r.body.errors?.[0]?.message), "재업로드 → 이미 등록 오류");

  // 초기 비밀번호 = 이메일, 로그인 시 변경 강제 + 마지막 로그인 기록
  const nl = await login(u1, u1);
  const nb = await j(nl.clone());
  assert(nl.status === 200 && nb.body.ok === true, "초기 비밀번호(이메일)로 로그인", `status ${nl.status}`);
  const newUser = cookieOf(nl);
  assert((await fetch(`${BASE}/api/assets`, { headers: newUser })).status === 403, "비밀번호 변경 전 업무 API 차단");
  // 세션 유효성 확인용 — /api/auth/refresh 는 강제 게이트 밖이고 getSession(DB 대조)을 거친다
  const refresh = () => fetch(`${BASE}/api/auth/refresh`, { method: "POST", headers: { ...newUser, "Content-Type": "application/json" } });
  assert((await refresh()).status === 200, "신규 계정 세션 유효");
  list = (await j(await fetch(`${BASE}/api/users`, { headers: admin }))).body;
  assert(list.find((u) => u.username === u1)?.last_login_at, "로그인 후 last_login_at 기록");

  // 장기 미사용
  if (DB_PATH) {
    const db = new Database(DB_PATH);
    db.prepare("UPDATE users SET created_at = datetime('now','-7 months','localtime'), last_login_at = datetime('now','-7 months','localtime') WHERE username IN (?, ?)").run(u1, u2);
    db.close();
    r = await j(await fetch(`${BASE}/api/users/inactive`, { headers: admin }));
    const names = (r.body.users || []).map((u) => u.username);
    assert(r.status === 200 && names.includes(u1) && names.includes(u2) && !names.includes("admin@example.go.kr"), "점검 대상에 7개월 미사용 계정 포함, 활동 중인 총괄 제외", JSON.stringify(r.body));
    r = await j(await fetch(`${BASE}/api/users/inactive`, { method: "POST", headers: admin }));
    assert(r.status === 200 && r.body.deactivated.includes(u1), "즉시 비활성화", JSON.stringify(r.body));
    assert((await refresh()).status === 401, "비활성화된 계정의 기존 세션 차단");
    assert((await login(u1, u1)).status === 401, "비활성화된 계정 로그인 거부");

    // 재활성화하면 그 시각부터 다시 센다 — 다음 점검에서 바로 잠기지 않는다
    const put = await j(await fetch(`${BASE}/api/users/${c1.id}`, { method: "PUT", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify({ username: u1, display_name: "일괄1", role: "team", team_id: teams[0].id, is_active: 1 }) }));
    assert(put.status === 200, "재활성화", JSON.stringify(put.body));
    r = await j(await fetch(`${BASE}/api/users/inactive`, { headers: admin }));
    assert(!(r.body.users || []).some((u) => u.username === u1), "재활성화 직후 점검 대상 아님");
  } else {
    console.log("  - ASSET_DB_PATH 미지정 — 장기 미사용 시나리오 건너뜀");
  }

  // 정리
  for (const u of [c1, c2]) if (u) await fetch(`${BASE}/api/users/${u.id}`, { method: "DELETE", headers: admin });
  if (createdTeam) await fetch(`${BASE}/api/teams/${createdTeam}`, { method: "DELETE", headers: admin });

  console.log(failures ? `\n✗ ${failures}건 실패` : "\n✓ 전부 통과");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

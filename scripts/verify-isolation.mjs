// ── 팀 간 행 격리(IDOR) E2E ──
// 팀 A 소유 자원(자산·부속·계약·위치·랙·대역·배선반·반출입·유지보수)을 만들고, 팀 B 계정이
// 그 id 로 직접 읽기·수정·삭제·연결을 시도한다. 판정:
//   1) 팀 B 의 목록 응답에 팀 A id 가 없다
//   2) 팀 B 의 단건 조회/쓰기/삭제가 2xx 가 아니다(403/404/400)
//   3) 공격 뒤 총괄 스냅샷이 공격 전과 같다 (상태코드와 무관하게 실제로 바뀐 게 없음)
//   4) 팀 A 본인은 같은 자원을 정상 조회한다(대조군)
// 메뉴 권한 때문에 막힌 것과 구분하려고 team 역할에 전 메뉴 접근·쓰기·승인을 잠시 부여하고 끝나면 원복한다.
// 사용: 서버 기동 후  node scripts/verify-isolation.mjs  (BASE_URL). 스크래치/시드 DB 전용 — 팀·계정·자원을 만들고 지운다.
import { createHash } from "crypto";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const sha512 = (s) => createHash("sha512").update(s).digest("hex");
let failures = 0;
const ok = (n) => console.log(`  ✓ ${n}`);
const fail = (n, d) => { failures++; console.error(`  ✗ ${n} — ${d}`); };
const assert = (c, n, d = "") => (c ? ok(n) : fail(n, d));
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
const tag = `ISO-${Date.now().toString(36)}`;

async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: sha512(password) }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`login ${username} → ${r.status} ${JSON.stringify(body)}`);
  return { Cookie: (r.headers.get("set-cookie") || "").split(";")[0], "Content-Type": "application/json" };
}
const call = async (h, method, path, body) =>
  j(await fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
const rowsOf = (b) => (Array.isArray(b) ? b : Array.isArray(b?.rows) ? b.rows : Array.isArray(b?.logs) ? b.logs : []);
const idOf = (b) => b?.id ?? b?.asset?.id ?? b?.row?.id ?? null;

async function main() {
  console.log(`── verify-isolation: ${BASE} ──`);
  const admin = await login("admin@example.go.kr", "admin123");

  // ── 준비: 팀 A/B + 팀 계정 2개 + team 역할 전 메뉴 허용 ──
  const teamA = (await call(admin, "POST", "/api/teams", { team_name: `${tag}-A` })).body;
  const teamB = (await call(admin, "POST", "/api/teams", { team_name: `${tag}-B` })).body;
  assert(teamA?.id && teamB?.id, "팀 A/B 생성", JSON.stringify({ teamA, teamB }));
  const pw = "Iso!test-2026";
  const mkUser = async (u, t) => (await call(admin, "POST", "/api/users", { username: u, password: sha512(pw), display_name: u, role: "team", team_id: t })).body;
  const userA = await mkUser(`${tag.toLowerCase()}-a@example.go.kr`, teamA.id);
  const userB = await mkUser(`${tag.toLowerCase()}-b@example.go.kr`, teamB.id);
  assert(userA?.id && userB?.id, "팀 계정 A/B 생성", JSON.stringify({ userA, userB }));

  const origPerms = (await call(admin, "GET", "/api/permissions?role=team")).body;
  const permList = Array.isArray(origPerms) ? origPerms : origPerms?.permissions || [];
  const r0 = await call(admin, "PUT", "/api/permissions", { role: "team", permissions: permList.map((p) => ({ menu_key: p.menu_key, can_access: 1, can_write: 1, can_approve: 1 })) });
  assert(r0.status === 200, "team 역할 전 메뉴 접근·쓰기·승인 임시 부여", `${r0.status} ${JSON.stringify(r0.body)}`);

  const cleanup = [];
  try {
    // 새 계정은 must_change_password — 첫 로그인 후 비밀번호 변경으로 해제
    const loginTeam = async (u) => {
      let h = await login(u, pw);
      const me = (await call(h, "GET", "/api/auth/me")).body;
      if (me?.mustChangePassword || me?.must_change_password) {
        await call(h, "PUT", "/api/auth/password", { currentPassword: sha512(pw), newPassword: sha512(pw + "!") });
        h = await login(u, pw + "!");
      }
      return h;
    };
    const A = await loginTeam(userA.username || `${tag.toLowerCase()}-a@example.go.kr`);
    const B = await loginTeam(userB.username || `${tag.toLowerCase()}-b@example.go.kr`);

    // ── 팀 A 자원 (팀 A 계정이 직접 생성 → 소유 팀 자동 귀속) ──
    const res = {};
    const mk = async (key, path, body, listPath, nameKey) => {
      const r = await call(A, "POST", path, body);
      let id = idOf(r.body);
      if (!id && listPath) id = rowsOf((await call(A, "GET", listPath)).body).find((x) => x[nameKey] === body[nameKey])?.id ?? null;
      assert(r.status >= 200 && r.status < 300 && id, `팀 A ${key} 생성`, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
      res[key] = id;
      return id;
    };
    await mk("location", "/api/locations", { location_name: `${tag}-위치A` }, "/api/locations", "location_name");
    await mk("rack", "/api/racks", { rack_name: `${tag}-랙A`, location_id: res.location, total_units: 42 }, "/api/racks", "rack_name");
    await mk("asset", "/api/assets", { asset_type: "server", asset_name: `${tag}-자산A`, serial_number: `${tag}-SN` }, `/api/assets?q=${tag}-자산A`, "asset_name");
    await mk("subasset", "/api/sub-assets", { sub_name: `${tag}-부속A`, parent_asset_id: res.asset }, "/api/sub-assets", "sub_name");
    await mk("contract", "/api/contracts", { contract_name: `${tag}-계약A`, start_date: "2026-01-01", end_date: "2027-12-31" }, "/api/contracts", "contract_name");
    await mk("subnet", "/api/subnets", { subnet_name: `${tag}-대역A`, network_address: "10.250.1.0" }, "/api/subnets", "subnet_name");
    await mk("frame", "/api/frames", { frame_name: `${tag}-배선A`, location_id: res.location }, "/api/frames", "frame_name");
    await mk("movement", "/api/movements", { movement_type: "bring_out", asset_id: res.asset, reason: tag }, "/api/movements", "reason");
    await mk("maintenance", "/api/maintenance", { asset_id: res.asset, log_type: "inspection", symptom: `${tag}-유지A` }, "/api/maintenance", "symptom");

    // 공용 위치(소유 팀 없음): 팀 B 의 정상 사용 대조군 + "공용 위치에 타팀 랙" 공격에 쓴다
    const sharedLocRes = await call(admin, "POST", "/api/locations", { location_name: `${tag}-공용위치` });
    const sharedLoc = idOf(sharedLocRes.body) ?? rowsOf((await call(admin, "GET", "/api/locations")).body).find((x) => x.location_name === `${tag}-공용위치`)?.id;
    assert(sharedLoc, "공용 위치(소유 팀 없음) 생성", `${sharedLocRes.status} ${JSON.stringify(sharedLocRes.body).slice(0, 120)}`);

    const lists = {
      asset: "/api/assets?limit=0", subasset: "/api/sub-assets", contract: "/api/contracts", location: "/api/locations",
      rack: "/api/racks", subnet: "/api/subnets", frame: "/api/frames", movement: "/api/movements", maintenance: "/api/maintenance",
    };
    const snapshot = async () => {
      const s = {};
      for (const [k, p] of Object.entries(lists)) {
        if (!res[k]) continue;
        const row = rowsOf((await call(admin, "GET", p)).body).find((x) => x.id === res[k]);
        s[k] = row ? JSON.stringify(row) : null;
      }
      s.contractAssets = JSON.stringify((await call(admin, "GET", `/api/contracts/${res.contract}/assets`)).body);
      return s;
    };
    const before = await snapshot();
    assert(Object.values(before).every(Boolean), "총괄 스냅샷(공격 전) — 팀 A 자원 전부 존재", JSON.stringify(Object.keys(before).filter((k) => !before[k])));

    // 대조군: 팀 A 는 자기 자원을 본다
    for (const [k, p] of Object.entries(lists)) {
      if (!res[k]) continue;
      const seen = rowsOf((await call(A, "GET", p)).body).some((x) => x.id === res[k]);
      assert(seen, `대조군: 팀 A 목록에 자기 ${k} 존재`, "");
    }

    // 1) 팀 B 목록에 팀 A id 없음
    for (const [k, p] of Object.entries(lists)) {
      if (!res[k]) continue;
      const r = await call(B, "GET", p);
      const leaked = rowsOf(r.body).some((x) => x.id === res[k]);
      assert(!leaked, `팀 B 목록에 팀 A ${k} 미노출 (${p} → ${r.status})`, `id=${res[k]} 노출`);
    }

    // 2) 팀 B 직접 id 공격 — 2xx 면 실패
    const attacks = [
      ["GET", `/api/assets/${res.asset}`],
      ["PUT", `/api/assets/${res.asset}`, { asset_type: "server", asset_name: "HIJACK", team_id: teamB.id }],
      ["DELETE", `/api/assets/${res.asset}`],
      ["GET", `/api/assets/${res.asset}/logs`],
      ["POST", `/api/assets/${res.asset}/verify`],
      ["POST", "/api/assets/verify", { asset_ids: [res.asset] }],
      ["PATCH", "/api/assets/bulk", { asset_ids: [res.asset], patch: { status: "retired" } }],
      ["DELETE", "/api/assets/bulk", { asset_ids: [res.asset] }],
      ["POST", "/api/assets/reassign", { asset_ids: [res.asset], team_id: teamB.id }],
      ["PUT", `/api/sub-assets/${res.subasset}`, { sub_name: "HIJACK" }],
      ["DELETE", `/api/sub-assets/${res.subasset}`],
      ["POST", "/api/sub-assets", { sub_name: `${tag}-B부속`, parent_asset_id: res.asset }],
      ["PUT", `/api/contracts/${res.contract}`, { contract_name: "HIJACK", start_date: "2026-01-01", end_date: "2027-12-31" }],
      ["DELETE", `/api/contracts/${res.contract}`],
      ["GET", `/api/contracts/${res.contract}/assets`],
      ["POST", `/api/contracts/${res.contract}/assets`, { asset_id: res.asset }],
      ["PUT", `/api/locations/${res.location}`, { location_name: "HIJACK" }],
      ["DELETE", `/api/locations/${res.location}`],
      ["PUT", `/api/racks/${res.rack}`, { rack_name: "HIJACK", location_id: res.location, total_units: 42 }],
      ["DELETE", `/api/racks/${res.rack}`],
      ["POST", "/api/racks", { rack_name: `${tag}-B랙`, location_id: res.location, total_units: 42 }],
      ["POST", "/api/subnets", { subnet_name: `${tag}-B대역`, network_address: "10.250.2.0", location_id: res.location }],
      ["POST", "/api/frames", { frame_name: `${tag}-B배선`, location_id: res.location }],
      ["POST", "/api/frames", { frame_name: `${tag}-B배선2`, location_id: sharedLoc, rack_id: res.rack }],
      ["POST", "/api/assets", { asset_type: "server", asset_name: `${tag}-B자산`, rack_id: res.rack, rack_unit_start: 1, rack_unit_size: 1 }],
      ["GET", `/api/subnets/${res.subnet}`],
      ["PUT", `/api/subnets/${res.subnet}`, { subnet_name: "HIJACK", network_address: "10.250.1.0" }],
      ["DELETE", `/api/subnets/${res.subnet}`],
      ["GET", `/api/frames/${res.frame}`],
      ["PUT", `/api/frames/${res.frame}`, { frame_name: "HIJACK", location_id: res.location }],
      ["DELETE", `/api/frames/${res.frame}`],
      ["GET", `/api/frames/${res.frame}/pairs`],
      ["PUT", `/api/frames/${res.frame}/pairs`, [{ pair_number: 1, label: "HIJACK" }]],
      ["GET", `/api/frames/${res.frame}/ledger`],
      ["PUT", `/api/movements/${res.movement}`, { status: "approved" }],
      ["DELETE", `/api/movements/${res.movement}`],
      ["POST", "/api/movements", { movement_type: "bring_out", asset_id: res.asset, reason: "HIJACK" }],
      ["PUT", `/api/maintenance/${res.maintenance}`, { symptom: "HIJACK", status: "resolved" }],
      ["DELETE", `/api/maintenance/${res.maintenance}`],
      ["POST", "/api/maintenance", { asset_id: res.asset, log_type: "inspection", symptom: "HIJACK" }],
    ];
    // 일괄 엔드포인트는 범위 밖 id 를 조용히 건너뛰고 200 {updated/deleted/verified: 0, skipped: n} 을 준다 — 0건이면 통과.
    const bulkNoop = (b) => b && b.ok === true && [b.updated, b.deleted, b.verified, b.reassigned].every((v) => v === undefined || v === 0);
    for (const [m, p, b] of attacks) {
      if (p.includes("/null") || p.includes("/undefined")) continue;
      const r = await call(B, m, p, b);
      const s2xx = r.status >= 200 && r.status < 300;
      const leakedRead = m === "GET" && JSON.stringify(r.body).includes(tag);
      const okResult = !s2xx || (m === "GET" ? !leakedRead && !r.body?.id : bulkNoop(r.body));
      assert(okResult, `팀 B ${m} ${p} → ${r.status}`, JSON.stringify(r.body).slice(0, 160));
    }

    // 2-1) 대조군 — 막는 검사가 정상 사용까지 막지 않는다
    const own = {};
    const okMk = async (key, path, body) => {
      const r = await call(B, "POST", path, body);
      own[key] = idOf(r.body);
      assert(r.status >= 200 && r.status < 300, `대조군: 팀 B ${key} 생성 (공용 위치·자기 자원)`, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    };
    await okMk("rack", "/api/racks", { rack_name: `${tag}-B공용랙`, location_id: sharedLoc, total_units: 42 });
    await okMk("subnet", "/api/subnets", { subnet_name: `${tag}-B공용대역`, network_address: "10.250.3.0", location_id: sharedLoc });
    await okMk("frame", "/api/frames", { frame_name: `${tag}-B공용배선`, location_id: sharedLoc });
    await okMk("asset", "/api/assets", { asset_type: "server", asset_name: `${tag}-B자산`, serial_number: `${tag}-BSN` });
    if (!own.asset) own.asset = rowsOf((await call(B, "GET", `/api/assets?q=${tag}-B자산`)).body).find((x) => x.asset_name === `${tag}-B자산`)?.id;
    await okMk("subasset", "/api/sub-assets", { sub_name: `${tag}-B부속`, parent_asset_id: own.asset });
    if (!own.subasset) own.subasset = rowsOf((await call(B, "GET", "/api/sub-assets")).body).find((x) => x.sub_name === `${tag}-B부속`)?.id;

    // 자기 부속을 타팀 자산 밑으로 옮기기 / 자기 랙을 타팀 위치로 옮기기 — 거부
    for (const [m, pth, b] of [
      ["PUT", `/api/sub-assets/${own.subasset}`, { sub_name: `${tag}-B부속`, parent_asset_id: res.asset }],
      ["PUT", `/api/racks/${own.rack}`, { rack_name: `${tag}-B공용랙`, location_id: res.location, total_units: 42 }],
      ["PUT", `/api/subnets/${own.subnet}`, { subnet_name: `${tag}-B공용대역`, network_address: "10.250.3.0", location_id: res.location }],
      ["PUT", `/api/frames/${own.frame}`, { frame_name: `${tag}-B공용배선`, location_id: res.location }],
      ["PUT", `/api/frames/${own.frame}`, { frame_name: `${tag}-B공용배선`, location_id: sharedLoc, rack_id: res.rack }],
    ]) {
      const r = await call(B, m, pth, b);
      assert(r.status === 403, `팀 B 자기 자원 ${m} ${pth} 로 타팀 참조 → 403`, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    }
    // 같은 값으로 다시 저장(참조 변경 없음)은 통과 — 기존 값은 재검사하지 않는다
    const same = await call(B, "PUT", `/api/racks/${own.rack}`, { rack_name: `${tag}-B공용랙2`, location_id: sharedLoc, total_units: 42 });
    assert(same.status === 200, "대조군: 팀 B 자기 랙 이름만 수정 → 200", `${same.status} ${JSON.stringify(same.body).slice(0, 160)}`);

    // 3) 공격 뒤 실제 변화 없음
    const after = await snapshot();
    for (const k of Object.keys(before)) assert(before[k] === after[k], `공격 뒤 팀 A ${k} 불변`, `before=${before[k]?.slice(0, 120)} after=${after[k]?.slice(0, 120)}`);
    const auditB = rowsOf((await call(admin, "GET", `/api/audit?limit=200`)).body).filter((l) => l.changed_by === (userB.username || "") || String(l.changed_by).startsWith(`${tag.toLowerCase()}-b`));
    // 팀 A 자원(id·종류) 을 팀 B 가 바꾼 감사 기록이 없어야 한다 — 팀 B 가 자기 대조군 자원을 만들고 고친 기록은 정상
    const auditType = { asset: "asset", subasset: "sub_asset", contract: "contract", location: "location", rack: "rack", subnet: "subnet", frame: "frame", movement: "movement", maintenance: "maintenance" };
    const teamAKeys = new Set(Object.entries(res).filter(([, id]) => id != null).map(([k, id]) => `${auditType[k] || k}:${id}`));
    const touchedA = auditB.filter((l) => teamAKeys.has(`${l.entity_type}:${l.entity_id}`));
    assert(touchedA.length === 0, "팀 B 이름으로 팀 A 자원 변경 감사로그 없음", JSON.stringify(touchedA.slice(0, 3)));

    cleanup.push(res, own, { sharedLoc });
  } finally {
    // ── 정리: 권한 원복 → 팀 A 자원 삭제(총괄) → 계정·팀 삭제 ──
    await call(admin, "PUT", "/api/permissions", { role: "team", permissions: permList.map((p) => ({ menu_key: p.menu_key, can_access: p.can_access, can_write: p.can_write, can_approve: p.can_approve })) });
    const res = cleanup[0] || {};
    const del = async (p) => { if (!p.includes("/undefined") && !p.includes("/null")) await call(admin, "DELETE", p); };
    if (res.maintenance) await del(`/api/maintenance/${res.maintenance}`);
    if (res.movement) await del(`/api/movements/${res.movement}`);
    if (res.contract) await del(`/api/contracts/${res.contract}`);
    if (res.subasset) await del(`/api/sub-assets/${res.subasset}`);
    if (res.asset) await del(`/api/assets/${res.asset}`);
    if (res.frame) await del(`/api/frames/${res.frame}`);
    if (res.subnet) await del(`/api/subnets/${res.subnet}`);
    if (res.rack) await del(`/api/racks/${res.rack}`);
    if (res.location) await del(`/api/locations/${res.location}`);
    const own = cleanup[1] || {};
    if (own.subasset) await del(`/api/sub-assets/${own.subasset}`);
    if (own.asset) await del(`/api/assets/${own.asset}`);
    if (own.frame) await del(`/api/frames/${own.frame}`);
    if (own.subnet) await del(`/api/subnets/${own.subnet}`);
    if (own.rack) await del(`/api/racks/${own.rack}`);
    if (cleanup[2]?.sharedLoc) await del(`/api/locations/${cleanup[2].sharedLoc}`);
    if (userA?.id) await call(admin, "DELETE", `/api/users/${userA.id}`);
    if (userB?.id) await call(admin, "DELETE", `/api/users/${userB.id}`);
    if (teamA?.id) await call(admin, "DELETE", `/api/teams/${teamA.id}`);
    if (teamB?.id) await call(admin, "DELETE", `/api/teams/${teamB.id}`);
    const restored = (await call(admin, "GET", "/api/permissions?role=team")).body;
    const rl = Array.isArray(restored) ? restored : restored?.permissions || [];
    assert(JSON.stringify(rl.map((p) => [p.menu_key, p.can_access, p.can_write, p.can_approve])) === JSON.stringify(permList.map((p) => [p.menu_key, p.can_access, p.can_write, p.can_approve])), "정리: team 권한 원복", "");
  }

  console.log(failures ? `── FAIL (${failures}) ──` : "── PASS ──");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

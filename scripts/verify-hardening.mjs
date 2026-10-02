// ── 운영 결함 수정분 E2E ──
// /api/health · MFA 등록 강제(msr) 미들웨어 게이트 · 취약 비밀번호 자진 신고 → 강제 변경 · 업로드 상한
// 사용: BASE_URL=http://localhost:3000 node scripts/verify-hardening.mjs   (시드 계정 3종 필요, 실운영 DB 금지)
// 전제: 서버가 MFA_REQUIRED_ROLES=admin(기본) 으로 기동됨.
import { createHash } from "crypto";
import { deflateRawSync } from "zlib";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const sha512 = (s) => createHash("sha512").update(s).digest("hex");
let failures = 0;
const ok = (n) => console.log(`  ✓ ${n}`);
const fail = (n, d) => { failures++; console.error(`  ✗ ${n} — ${d}`); };
const assert = (c, n, d = "") => (c ? ok(n) : fail(n, d));

/** 최소 zip(deflate) 조립 — 압축 폭탄 픽스처용. CRC 는 앱이 검사하지 않으므로 0. */
function zipOf(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [n, data] of entries) {
    const body = deflateRawSync(data), name = Buffer.from(n);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body); centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function jar() {
  let cookie = "";
  return {
    async req(path, opts = {}, body, raw) {
      const res = await fetch(`${BASE}${path}`, {
        method: opts.method || "GET",
        headers: { ...(body && !raw ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
        body: raw ? body : body ? JSON.stringify(body) : undefined,
        redirect: "manual",
      });
      const sc = res.headers.get("set-cookie");
      if (sc) cookie = sc.split(";")[0];
      let data = null;
      try { data = await res.clone().json(); } catch { /* html */ }
      return { status: res.status, body: data ?? {}, headers: res.headers, text: data ? "" : await res.text() };
    },
  };
}

async function main() {
  console.log(`── verify-hardening: ${BASE} ──`);

  // 1) /api/health — 무인증, 업무정보 미노출
  const anon = jar();
  let r = await anon.req("/api/health");
  assert(r.status === 200 && r.body.ok === true && r.body.db === "ok" && typeof r.body.schema === "number", "/api/health 무인증 200 + db ok + schema", `${r.status} ${JSON.stringify(r.body)}`);
  assert(!("assets" in r.body) && !("users" in r.body), "/api/health 는 업무 수치 미노출");
  assert(r.headers.get("cache-control")?.includes("no-store"), "/api/health no-store");

  // 2) MFA 등록 강제: admin(미등록) 로그인 → 세션은 받되 msr 게이트
  const admin = jar();
  r = await admin.req("/api/auth/login", { method: "POST" }, { username: "admin@example.go.kr", password: sha512("admin123") });
  assert(r.status === 200 && r.body.ok && r.body.mfaSetupRequired === true, "총괄(미등록) 로그인 → mfaSetupRequired", `${r.status} ${JSON.stringify(r.body)}`);
  r = await admin.req("/api/assets?limit=1");
  assert(r.status === 403 && r.body.error === "MFA_SETUP_REQUIRED", "msr 상태에서 업무 API 403 MFA_SETUP_REQUIRED", `${r.status} ${JSON.stringify(r.body)}`);
  r = await admin.req("/");
  assert(r.status === 307 && (r.headers.get("location") || "").includes("/settings?tab=mfa&required=1"), "msr 상태에서 페이지 → /settings?tab=mfa 리다이렉트", `${r.status} ${r.headers.get("location")}`);
  r = await admin.req("/settings");
  assert(r.status === 200, "msr 상태에서도 /settings 는 열림", `${r.status}`);
  r = await admin.req("/api/auth/mfa/setup", { method: "POST" });
  assert(r.status === 200 && r.body.secret, "msr 상태에서 등록 API 허용", `${r.status}`);
  const secret = r.body.secret;
  // 등록 완료 → 세션 재발급 → 게이트 해제
  const { createHmac } = await import("crypto");
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const b32d = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
  const totpAt = (sec, c) => { const b = Buffer.alloc(8); b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4); const h = createHmac("sha1", b32d(sec)).update(b).digest(); const o = h[h.length - 1] & 15; const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]; return String(n % 1e6).padStart(6, "0"); };
  const c0 = Math.floor(Date.now() / 1000 / 30);
  r = await admin.req("/api/auth/mfa/setup", { method: "PUT" }, { code: totpAt(secret, c0) });
  assert(r.status === 200 && r.body.backupCodes?.length === 10, "등록 확인", `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
  r = await admin.req("/api/assets?limit=1");
  assert(r.status === 200, "등록 후 재로그인 없이 업무 API 200 (세션 재발급)", `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
  // 정리: 다음 창 코드로 해제
  r = await admin.req("/api/auth/mfa/setup", { method: "DELETE" }, { code: totpAt(secret, c0 + 1) });
  assert(r.status === 200, "정리: MFA 해제", `${r.status}`);

  // team 은 강제 대상 아님
  const team = jar();
  r = await team.req("/api/auth/login", { method: "POST" }, { username: "user@example.go.kr", password: sha512("user123") });
  assert(r.status === 200 && r.body.ok && !r.body.mfaSetupRequired, "team 로그인은 강제 없음", `${r.status} ${JSON.stringify(r.body)}`);
  r = await team.req("/api/assets?limit=1");
  assert(r.status === 200, "team 업무 API 정상", `${r.status}`);

  // 3) 취약 비밀번호 자진 신고 → mcp 세션 → 변경 화면 외 차단
  const viewer = jar();
  r = await viewer.req("/api/auth/login", { method: "POST" }, { username: "viewer@example.go.kr", password: sha512("viewer123") });
  assert(r.status === 200 && r.body.ok, "viewer 로그인", `${r.status}`);
  r = await viewer.req("/api/auth/password/weak", { method: "POST" });
  assert(r.status === 200 && r.body.mustChangePassword === true, "취약 비밀번호 신고 → must_change 켜짐", `${r.status} ${JSON.stringify(r.body)}`);
  r = await viewer.req("/api/assets?limit=1");
  assert(r.status === 403 && r.body.error === "PASSWORD_CHANGE_REQUIRED", "신고 직후 업무 API 403 (세션 재발급으로 즉시 적용)", `${r.status} ${JSON.stringify(r.body)}`);
  r = await viewer.req("/change-password");
  assert(r.status === 200, "/change-password 는 열림", `${r.status}`);
  // 정리: 비밀번호를 그대로 다시 설정해 must_change 해제 (정책 통과값)
  r = await viewer.req("/api/auth/password", { method: "PUT" }, { currentPassword: sha512("viewer123"), newPassword: sha512("viewer123") });
  if (r.status !== 200) {
    // 동일 비밀번호 거부 정책이면 다른 값으로 바꿨다가 되돌린다
    await viewer.req("/api/auth/password", { method: "PUT" }, { currentPassword: sha512("viewer123"), newPassword: sha512("viewer1234") });
    r = await viewer.req("/api/auth/password", { method: "PUT" }, { currentPassword: sha512("viewer1234"), newPassword: sha512("viewer123") });
  }
  assert(r.status === 200, "정리: viewer 비밀번호 원복 + must_change 해제", `${r.status} ${JSON.stringify(r.body)}`);

  // 4) 업로드 상한 — 21MB 더미를 xlsx 로 위장해 전송 → 400 (매직바이트 검사 전에 크기로 차단)
  //    시드의 team 계정은 팀 미배정(쓰기 403)이라, 앞서 MFA 등록으로 게이트가 풀린 admin 세션으로 팀을 잠시 배정한다.
  const users = (await admin.req("/api/users")).body;
  const teamUser = Array.isArray(users) ? users.find((u) => u.username === "user@example.go.kr") : null;
  let teams = (await admin.req("/api/teams")).body;
  let createdTeamId = null;
  if (Array.isArray(teams) && teams.length === 0) {
    const t = await admin.req("/api/teams", { method: "POST" }, { team_name: "E2E-업로드검증" });
    createdTeamId = t.body?.id ?? null;
    teams = (await admin.req("/api/teams")).body;
  }
  const firstTeam = Array.isArray(teams) ? teams[0] : null;
  const origTeamId = teamUser?.team_id ?? null;
  if (teamUser && firstTeam && origTeamId == null) {
    await admin.req("/api/users/" + teamUser.id, { method: "PUT" }, { display_name: teamUser.display_name, role: "team", team_id: firstTeam.id, is_active: 1 });
    await team.req("/api/auth/logout", { method: "POST" });
    await team.req("/api/auth/login", { method: "POST" }, { username: "user@example.go.kr", password: sha512("user123") });
  }
  const big = new Blob([new Uint8Array(21 * 1024 * 1024)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const fd = new FormData(); fd.append("file", big, "big.xlsx");
  r = await team.req("/api/assets/import", { method: "POST" }, fd, true);
  assert(r.status === 400 && /너무 큽니다/.test(r.body.error || ""), "21MB 업로드 → 400 크기 초과", `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  const small = new Blob([new Uint8Array(10)]); const fd2 = new FormData(); fd2.append("file", small, "x.xlsx");
  r = await team.req("/api/assets/import", { method: "POST" }, fd2, true);
  assert(r.status === 400 && /xlsx/.test(r.body.error || ""), "작은 비-xlsx → 400 매직바이트(크기는 통과)", `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  // 5) 압축 폭탄 — 수십 KB 가 70MB 로 풀리는 zip(.xlsx 위장). 크기 상한은 통과하므로 XLSX.read 전에 해제량으로 끊어야 한다.
  //    배선반 일괄(이전엔 매직바이트·폭탄 검사 없이 XLSX.read)과 자산 임포트 둘 다, 빠르게 400.
  const bomb = zipOf([["[Content_Types].xml", Buffer.from("<Types/>")], ["xl/worksheets/sheet1.xml", Buffer.alloc(70 * 1024 * 1024)]]);
  for (const [who, url] of [[team, "/api/assets/import"], [admin, "/api/frames/bulk"]]) {
    const fd3 = new FormData(); fd3.append("file", new Blob([bomb]), "bomb.xlsx");
    const t0 = Date.now();
    r = await who.req(url, { method: "POST" }, fd3, true);
    const ms = Date.now() - t0;
    assert(r.status === 400 && /압축을 풀면/.test(r.body.error || "") && ms < 5000, `${url} 압축 폭탄(${(bomb.length / 1024).toFixed(0)}KB→70MB) → 400`, `${r.status} ${ms}ms ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  const fake = new Blob([Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(4096, 0x41)])]);
  const fd4 = new FormData(); fd4.append("file", fake, "fake.xlsx");
  r = await admin.req("/api/frames/bulk", { method: "POST" }, fd4, true);
  assert(r.status === 400, "/api/frames/bulk 손상 zip(PK 위장) → 400 (500 아님)", `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  // 정리: 팀 배정 원복
  if (teamUser && firstTeam && origTeamId == null) {
    await admin.req("/api/users/" + teamUser.id, { method: "PUT" }, { display_name: teamUser.display_name, role: "team", team_id: null, is_active: 1 });
  }
  if (createdTeamId) await admin.req("/api/teams/" + createdTeamId, { method: "DELETE" });

  console.log(failures === 0 ? "── PASS ──" : `── FAIL (${failures}) ──`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

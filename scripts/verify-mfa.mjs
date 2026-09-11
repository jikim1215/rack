// ── 2단계 인증(TOTP) E2E ──
// 기동 중인 서버에 대해 등록 → 로그인 2단계 → replay 차단 → 백업코드 1회성 → 관리자 해제까지 검증한다.
// 사용: BASE_URL=http://localhost:3000 node scripts/verify-mfa.mjs
// 주의: 검증 계정의 MFA 를 켰다가 마지막에 해제한다. 실운영 DB 에는 돌리지 말 것.
import { createHash, createHmac } from "crypto";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const USER = process.env.MFA_USER || "admin@example.go.kr";
const PASS = process.env.MFA_PASS || "admin123";
const sha512 = (s) => createHash("sha512").update(s).digest("hex");
let failures = 0;
const ok = (n) => console.log(`  ✓ ${n}`);
const fail = (n, d) => { failures++; console.error(`  ✗ ${n} — ${d}`); };
const assert = (c, n, d = "") => (c ? ok(n) : fail(n, d));

// 서버와 동일한 TOTP 계산 (검증 스크립트가 독립적으로 코드를 만들어야 진짜 E2E)
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32decode(s) {
  const c = s.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  let bits = 0, value = 0; const out = [];
  for (const ch of c) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totpAt(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(code % 1e6).padStart(6, "0");
}
const nowCounter = () => Math.floor(Date.now() / 1000 / 30);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 서버 정책과 맞물린 코드 선택기:
//  - 서버는 now±1 스텝만 허용하고, lastCounter 이하(이미 쓴 코드)는 replay 로 거부한다.
//  - 따라서 "minCounter 보다 크면서 현재 창 안" 인 counter 를 골라야 한다. 없으면 다음 창까지 기다린다.
//    (실사용자도 "다음 코드" 를 기다리는 것과 같은 동작)
async function freshCode(secret, minCounter) {
  for (;;) {
    const now = nowCounter();
    const cand = Math.max(now, minCounter + 1);
    if (cand <= now + 1) return { code: totpAt(secret, cand), counter: cand };
    await sleep(1000);
  }
}

let cookie = "";
async function req(path, opts = {}, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || "GET",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  let data = null;
  try { data = await res.json(); } catch { /* HTML 응답 */ }
  return { status: res.status, body: data ?? {} };
}

async function main() {
  console.log(`── verify-mfa: ${BASE} ──`);

  // 0) 일반 로그인 (MFA 꺼진 상태)
  let r = await req("/api/auth/login", { method: "POST" }, { username: USER, password: sha512(PASS) });
  assert(r.status === 200 && r.body.ok, "1단계: 비밀번호 로그인", `${r.status} ${JSON.stringify(r.body)}`);
  if (r.status !== 200) { console.log("── FAIL ──"); process.exit(1); }

  // 1) 등록 시작 — 시크릿 발급 (아직 활성 아님)
  r = await req("/api/auth/mfa/setup", { method: "POST" });
  assert(r.status === 200 && /^[A-Z2-7]{32}$/.test(r.body.secret || ""), "시크릿 발급", JSON.stringify(r.body).slice(0, 120));
  const secret = r.body.secret;
  assert((r.body.otpauthUri || "").startsWith("otpauth://totp/"), "otpauth URI 제공");
  r = await req("/api/auth/mfa/setup");
  assert(r.body.enabled === false && r.body.pendingSetup === true, "확인 전에는 비활성(pendingSetup)", JSON.stringify(r.body));

  // 2) 잘못된 코드로 활성화 시도 → 400
  r = await req("/api/auth/mfa/setup", { method: "PUT" }, { code: "000000" });
  assert(r.status === 400, "잘못된 코드로는 활성화 불가", `${r.status}`);

  // 3) 올바른 코드로 활성화 → 백업 코드 10개
  const enable = await freshCode(secret, -1);
  let lastUsed = enable.counter;   // 서버가 totp_last_counter 로 기록하는 값
  r = await req("/api/auth/mfa/setup", { method: "PUT" }, { code: enable.code });
  assert(r.status === 200 && Array.isArray(r.body.backupCodes) && r.body.backupCodes.length === 10, "활성화 + 백업코드 10개 발급", `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  const backupCodes = r.body.backupCodes || [];

  // 4) 로그아웃 후 재로그인 → 이제 세션이 아니라 mfaRequired
  await req("/api/auth/logout", { method: "POST" });
  r = await req("/api/auth/login", { method: "POST" }, { username: USER, password: sha512(PASS) });
  assert(r.status === 200 && r.body.mfaRequired === true && !r.body.ok, "2단계 요구 응답(mfaRequired)", `${r.status} ${JSON.stringify(r.body)}`);
  // ⚠ 회귀 가드: 이 응답은 HTTP 200 이다. 클라이언트가 res.ok 로 성공을 판단하면 2단계를 건너뛰고
  //   대시보드로 가다가 미들웨어에 튙겨 로그인 화면으로 되돌아온다(실제 발생했던 버그).
  //   그래서 본문의 ok 가 명시적으로 false 인지를 검사한다 — 클라이언트는 data.ok 로 판단해야 한다.
  assert(r.body.ok === false, "mfaRequired 응답의 ok 는 명시적 false (클라이언트 res.ok 오판 방지)", JSON.stringify(r.body));

  // 5) 대기 토큰으로는 어떤 API 도 못 쓴다
  r = await req("/api/auth/me");
  assert(r.status === 401, "대기 토큰으로 /api/auth/me 접근 차단", `${r.status}`);
  r = await req("/api/assets?limit=1");
  assert(r.status === 401, "대기 토큰으로 자산 API 접근 차단", `${r.status}`);

  // 6) 틀린 코드 → 401, 맞는 코드 → 세션 발급
  r = await req("/api/auth/mfa", { method: "POST" }, { code: "111111" });
  assert(r.status === 401 && /남은 시도/.test(r.body.error || ""), "틀린 코드 401 + 남은 시도 안내", `${r.status} ${JSON.stringify(r.body)}`);
  // 등록 때 쓴 코드는 이미 소모됐다(RFC 6238: 성공한 OTP 재사용 금지) → 다음 코드로 로그인
  const loginCode = await freshCode(secret, lastUsed);
  lastUsed = loginCode.counter;
  r = await req("/api/auth/mfa", { method: "POST" }, { code: loginCode.code });
  assert(r.status === 200 && r.body.ok && r.body.method === "totp", "올바른 코드로 세션 발급", `${r.status} ${JSON.stringify(r.body)}`);
  r = await req("/api/auth/me");
  assert(r.status === 200 && r.body.username === USER, "정식 세션으로 API 사용 가능", `${r.status}`);

  // 7) replay — 같은 코드 재사용 차단
  await req("/api/auth/logout", { method: "POST" });
  await req("/api/auth/login", { method: "POST" }, { username: USER, password: sha512(PASS) });
  r = await req("/api/auth/mfa", { method: "POST" }, { code: loginCode.code });
  assert(r.status === 401 && /이미 사용한 코드/.test(r.body.error || ""), "재사용(replay) 차단", `${r.status} ${JSON.stringify(r.body)}`);

  // 8) 백업 코드로 로그인 (1회용)
  r = await req("/api/auth/mfa", { method: "POST" }, { code: backupCodes[0] });
  assert(r.status === 200 && r.body.method === "backup" && r.body.backupCodesLeft === 9, "백업 코드 로그인 + 잔여 9개", `${r.status} ${JSON.stringify(r.body)}`);
  await req("/api/auth/logout", { method: "POST" });
  await req("/api/auth/login", { method: "POST" }, { username: USER, password: sha512(PASS) });
  r = await req("/api/auth/mfa", { method: "POST" }, { code: backupCodes[0] });
  assert(r.status === 401, "사용한 백업 코드는 재사용 불가", `${r.status}`);
  r = await req("/api/auth/mfa", { method: "POST" }, { code: backupCodes[1] });
  assert(r.status === 200, "다른 백업 코드는 사용 가능", `${r.status}`);

  // 9) 해제는 현재 코드를 요구
  r = await req("/api/auth/mfa/setup", { method: "DELETE" }, { code: "000000" });
  assert(r.status === 403, "코드 없이 해제 불가", `${r.status} ${JSON.stringify(r.body)}`);
  // 앞선 로그인에서 lastUsed 까지 소모됐으므로 그보다 큰 "현재 창" 코드를 고른다(필요하면 다음 창까지 대기)
  const delCode = await freshCode(secret, lastUsed);
  r = await req("/api/auth/mfa/setup", { method: "DELETE" }, { code: delCode.code });
  assert(r.status === 200, "현재 코드로 해제 성공", `${r.status} ${JSON.stringify(r.body)}`);
  r = await req("/api/auth/mfa/setup");
  assert(r.body.enabled === false && r.body.backupCodesLeft === 0, "해제 후 상태 초기화", JSON.stringify(r.body));

  // 10) 해제 후에는 1단계만으로 로그인
  await req("/api/auth/logout", { method: "POST" });
  r = await req("/api/auth/login", { method: "POST" }, { username: USER, password: sha512(PASS) });
  assert(r.status === 200 && r.body.ok === true, "해제 후 비밀번호만으로 로그인", `${r.status} ${JSON.stringify(r.body)}`);

  console.log(failures === 0 ? "── PASS ──" : `── FAIL (${failures}) ──`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

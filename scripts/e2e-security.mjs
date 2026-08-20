#!/usr/bin/env node
// P10 보안 하드닝 실 핸들러 e2e (AC-17/18). 기동 중인 standalone 서버 대상.
// 사용: BASE=http://localhost:PORT node scripts/e2e-security.mjs
import { createHash } from "node:crypto";

const BASE = process.env.BASE || "http://localhost:4500";
const sha = (s) => createHash("sha512").update(s).digest("hex");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.error("FAIL", m); } };

// 1. admin 로그인
const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: sha("admin123") }) });
ok(login.status === 200, `admin 로그인 200 (got ${login.status})`);
const setCookie = login.headers.get("set-cookie") || "";
ok(/HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie), "세션 쿠키 HttpOnly+SameSite=Strict");
const m = setCookie.match(/asset_session=([^;]+)/);
const token = m ? m[1] : "";
const cookie = `asset_session=${token}`;

// 2. 약한 비밀번호로 사용자 생성 → 정책 거부 400
const weak = await fetch(`${BASE}/api/users`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ username: "weakuser", password: "abc", display_name: "약함", role: "viewer" }) });
ok(weak.status === 400, `약한 비밀번호(abc) 거부 400 (got ${weak.status})`);
const weak2 = await fetch(`${BASE}/api/users`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ username: "weakuser2", password: "12345678", display_name: "숫자만", role: "viewer" }) });
ok(weak2.status === 400, `숫자만 8자(12345678) 거부 400 - 2종 조합 미충족 (got ${weak2.status})`);

// 3. 강한 비밀번호 → 생성 성공
const strong = await fetch(`${BASE}/api/users`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ username: "stronguser", password: "Abcd1234!", display_name: "강함", role: "viewer" }) });
ok(strong.status >= 200 && strong.status < 300, `강한 비밀번호(Abcd1234!) 생성 성공 ${strong.status}`);

// 4. 본인 비밀번호 변경 약함 → 400
const chg = await fetch(`${BASE}/api/auth/password`, { method: "PUT", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ currentPassword: sha("admin123"), newPassword: "short" }) });
ok(chg.status === 400, `본인 비밀번호 변경 약함(short) 거부 400 (got ${chg.status})`);

// 5. 토큰 위조 거부 — 서명 1글자 변조 → 보호 API 401/403 (200 아님)
const parts = token.split(".");
const tampered = parts.length === 2 ? `${parts[0]}.${parts[1].slice(0, -2)}${parts[1].slice(-2) === "AA" ? "BB" : "AA"}` : token + "x";
const forged = await fetch(`${BASE}/api/users`, { headers: { cookie: `asset_session=${tampered}` }, redirect: "manual" });
ok(forged.status !== 200, `위조 토큰 거부 (status ${forged.status} != 200)`);

// 6. 정상 토큰으로 보호 API 접근 가능
const okreq = await fetch(`${BASE}/api/users`, { headers: { cookie } });
ok(okreq.status === 200, `정상 토큰 보호 API 200 (got ${okreq.status})`);

console.log(`\n--- e2e-security pass=${pass} fail=${fail} ---`);
process.exit(fail ? 1 : 0);

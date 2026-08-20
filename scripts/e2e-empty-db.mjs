#!/usr/bin/env node
// 빈 DB 초기설정 가드 e2e (실 핸들러). 빈 DB 서버 → 503 "등록된 사용자가 없습니다", 시드 서버 → 200.
// 사용: BASE_EMPTY=http://localhost:PORT1 BASE_SEEDED=http://localhost:PORT2 node scripts/e2e-empty-db.mjs
import { createHash } from "node:crypto";
const sha = (s) => createHash("sha512").update(s).digest("hex");
const EMPTY = process.env.BASE_EMPTY;
const SEEDED = process.env.BASE_SEEDED;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.error("FAIL", m); } };

if (EMPTY) {
  const r = await fetch(`${EMPTY}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: sha("admin123") }) });
  const j = await r.json().catch(() => ({}));
  ok(r.status === 503, `빈 DB 로그인 → 503 (got ${r.status})`);
  ok(/등록된 사용자가 없습니다/.test(j.error || ""), `빈 DB 안내 메시지 ("${(j.error || "").slice(0, 40)}...")`);
}
if (SEEDED) {
  const r = await fetch(`${SEEDED}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: sha("admin123") }) });
  const j = await r.json().catch(() => ({}));
  ok(r.status === 200 && j.ok === true, `시드 DB 로그인 → 200 OK (got ${r.status})`);
}

console.log(`\n--- e2e-empty-db pass=${pass} fail=${fail} ---`);
process.exit(fail ? 1 : 0);

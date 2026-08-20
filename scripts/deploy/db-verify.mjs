#!/usr/bin/env node
// DB 무결성 검증 (AC-22 복구 리허설) — sqlite3 CLI 의존 제거: 번들 better-sqlite3.
// 사용: node db-verify.mjs <db>   → integrity_check=ok + assets 조회 가능하면 exit 0
import { createRequire } from "node:module";
import { join } from "node:path";

const [dbPath] = process.argv.slice(2);
if (!dbPath) { console.error("usage: db-verify.mjs <db>"); process.exit(2); }

const require = createRequire(import.meta.url);
let Database;
for (const p of [join(process.cwd(), ".next", "standalone", "node_modules", "better-sqlite3"), "better-sqlite3", join(process.cwd(), "node_modules", "better-sqlite3")]) {
  try { Database = require(p); break; } catch { /* next */ }
}
if (!Database) { console.error("[verify] better-sqlite3 로드 실패"); process.exit(1); }

try {
  const db = new Database(dbPath, { readonly: true });
  const ic = db.pragma("integrity_check", { simple: true });
  if (ic !== "ok") { console.error(`[verify] integrity_check 실패: ${ic}`); process.exit(1); }
  const n = db.prepare("SELECT COUNT(*) AS c FROM assets").get().c;
  db.close();
  console.log(`[verify] OK integrity=ok assets=${n}`);
} catch (e) {
  console.error(`[verify] 실패: ${e.message}`);
  process.exit(1);
}

#!/usr/bin/env node
// DB 백업 (AC-22) — sqlite3 CLI 의존 제거: 번들 better-sqlite3 online backup + gzip. 권한 600.
// 사용: node db-backup.mjs <src.db> <dest.gz>
import { createGzip } from "node:zlib";
import { createReadStream, createWriteStream, mkdtempSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";

const [src, dest] = process.argv.slice(2);
if (!src || !dest) { console.error("usage: db-backup.mjs <src.db> <dest.gz>"); process.exit(2); }

// better-sqlite3는 앱과 동봉(.next/standalone/node_modules 우선, 없으면 최상위)
const require = createRequire(import.meta.url);
let Database;
for (const p of [join(process.cwd(), ".next", "standalone", "node_modules", "better-sqlite3"), "better-sqlite3", join(process.cwd(), "node_modules", "better-sqlite3")]) {
  try { Database = require(p); break; } catch { /* try next */ }
}
if (!Database) { console.error("[backup] better-sqlite3 로드 실패"); process.exit(1); }

const tmp = mkdtempSync(join(tmpdir(), "bk-"));
const raw = join(tmp, "data.db");
try {
  const db = new Database(src, { readonly: true });
  await db.backup(raw); // WAL 안전 online backup
  db.close();
  await pipeline(createReadStream(raw), createGzip(), createWriteStream(dest));
  chmodSync(dest, 0o600);
  console.log(`[backup] OK ${dest} (권한 600)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

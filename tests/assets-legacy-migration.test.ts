// tests/assets-legacy-migration.test.ts — 구버전 assets(‘vm’ 이전 스키마)를 getDb() 가 열 때
// 재빌드형 마이그레이션이 import_batch_id 를 탈락시키지 않는지(=엑셀 일괄등록·배치 롤백이 동작하는지) 검증.
// 회귀 배경: 'vm'·'standby' 재빌드가 컬럼 목록에서 import_batch_id 를 빠뜨려, db-seed 로 시작한 운영 DB 에서
//            /api/assets/import 가 "table assets has no column named import_batch_id" 로 500 이었다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const dir = mkdtempSync(join(tmpdir(), "asset-legacy-"));
const DB = join(dir, "test.db");

// scripts/db-seed.mjs 의 assets DDL 과 같은 구버전 형태 (asset_type CHECK 에 'vm' 없음, import_batch_id 없음)
before(() => {
  const raw = new Database(DB);
  raw.pragma("journal_mode = WAL");
  raw.exec(`
    CREATE TABLE racks (id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER, rack_name TEXT NOT NULL, total_units INTEGER NOT NULL DEFAULT 42, description TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_type TEXT NOT NULL CHECK(asset_type IN ('server','network','security','telecom','other')),
      asset_name TEXT NOT NULL,
      manufacturer TEXT DEFAULT '', model TEXT DEFAULT '', serial_number TEXT DEFAULT '',
      ip_address TEXT DEFAULT '', asset_tag TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','maintenance','standby','retired')),
      purchase_date TEXT DEFAULT '', warranty_date TEXT DEFAULT '', eos_date TEXT DEFAULT '',
      description TEXT DEFAULT '', os TEXT DEFAULT '', access_ip TEXT DEFAULT '',
      user_name TEXT DEFAULT '', admin_name TEXT DEFAULT '', department TEXT DEFAULT '',
      rack_id INTEGER REFERENCES racks(id) ON DELETE SET NULL,
      rack_unit_start INTEGER, rack_unit_size INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);
  raw.prepare("INSERT INTO assets (asset_type, asset_name, serial_number) VALUES ('server','LEGACY-1','SN-1')").run();
  raw.close();
});

after(async () => {
  try { const { getDb } = await import("../src/lib/db.ts"); getDb().close(); } catch { /* noop */ }
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); } catch { /* Windows WAL 잠금 잔여 */ }
});

test("구버전 assets 재빌드 후에도 import_batch_id 컬럼이 존재하고 기존 행이 보존된다", async () => {
  process.env.ASSET_DB_PATH = DB;
  const { getDb } = await import("../src/lib/db.ts");
  const db = getDb();
  const cols = new Set((db.prepare("PRAGMA table_info(assets)").all() as { name: string }[]).map((c) => c.name));
  assert.ok(cols.has("import_batch_id"), "import_batch_id 탈락");
  assert.ok(cols.has("rack_side") && cols.has("team_id") && cols.has("verified_at"), "재빌드 이후 컬럼 탈락");
  const row = db.prepare("SELECT asset_name, serial_number FROM assets WHERE asset_name='LEGACY-1'").get() as { asset_name: string; serial_number: string };
  assert.equal(row.serial_number, "SN-1");
});

test("일괄등록 INSERT(import_batch_id) + 배치 롤백 미리보기가 동작한다", async () => {
  const { getDb } = await import("../src/lib/db.ts");
  const { rollbackPreview } = await import("../src/lib/import-rollback.ts");
  const db = getDb();
  db.prepare("INSERT INTO assets (asset_type, asset_name, import_batch_id) VALUES ('server','BATCH-1','b-legacy')").run();
  const preview = rollbackPreview(db, "b-legacy");
  assert.equal(preview?.total, 1);
});

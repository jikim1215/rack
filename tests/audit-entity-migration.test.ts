// tests/audit-entity-migration.test.ts — audit_logs.entity_type CHECK 확장 마이그레이션.
// 직전 릴리스 DB(13종 CHECK)에 subnet/vendor/setting 감사 행을 쓰면 SQLITE_CONSTRAINT_CHECK → API 400 이었다.
// getDb() 가 AUDIT_ENTITY_TYPES(단일 출처) 기준으로 재빌드해 새 종류를 받아들이고, 기존 행·append-only 를 유지하는지 확인.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { AUDIT_ENTITY_TYPES } from "../src/lib/db-types.ts";

const ROOT = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "asset-auditmig-"));
const DB = join(dir, "prev.db");

function boot(sql = "", query = ""): { rows: Record<string, unknown>[] } {
  const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "tests/fixtures/db-boot.mjs")], {
    cwd: ROOT, env: { ...process.env, ASSET_DB_PATH: DB, NODE_ENV: "test", BOOT_SQL: sql, BOOT_QUERY: query }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

before(() => {
  // 현행 스키마로 한 번 기동한 뒤, audit_logs 만 직전 릴리스(13종 CHECK) 형태로 되돌린다.
  boot();
  const raw = new Database(DB);
  raw.exec(`
    DROP TRIGGER IF EXISTS trg_audit_logs_no_update;
    DROP TRIGGER IF EXISTS trg_audit_logs_no_delete;
    DROP TABLE audit_logs;
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL DEFAULT 'asset' CHECK(entity_type IN ('asset','rack','location','frame','contract','movement','maintenance','inventory_audit','sub_asset','user','team','permission','feedback')),
      entity_id INTEGER,
      entity_name TEXT DEFAULT '',
      action TEXT NOT NULL CHECK(action IN ('create','update','delete')),
      changed_by TEXT DEFAULT '',
      changed_fields TEXT DEFAULT '[]',
      old_values TEXT DEFAULT '{}',
      new_values TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    INSERT INTO audit_logs (entity_type, entity_id, entity_name, action, changed_by) VALUES ('permission', 1, 'team', 'update', 'admin');
    INSERT INTO audit_logs (entity_type, entity_id, entity_name, action, changed_by) VALUES ('asset', 7, 'SRV-7', 'create', 'admin');
  `);
  assert.throws(() => raw.prepare("INSERT INTO audit_logs (entity_type, action) VALUES ('subnet','create')").run(), /CHECK constraint/);
  raw.close();
});

after(() => {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); } catch { /* Windows WAL 잠금 잔여 */ }
});

test("기동 후 AUDIT_ENTITY_TYPES 전 종류를 받아들이고 기존 감사 행을 보존한다", () => {
  const inserts = AUDIT_ENTITY_TYPES.map((t) => `INSERT INTO audit_logs (entity_type, entity_id, entity_name, action, changed_by) VALUES ('${t}', 1, 'mig-${t}', 'create', 't')`).join(";");
  const { rows } = boot(inserts, "SELECT entity_type, entity_name FROM audit_logs ORDER BY id");
  assert.deepEqual(rows.slice(0, 2), [{ entity_type: "permission", entity_name: "team" }, { entity_type: "asset", entity_name: "SRV-7" }]);
  assert.deepEqual(rows.slice(2).map((r) => r.entity_type), [...AUDIT_ENTITY_TYPES]);
});

test("재빌드 뒤에도 append-only(UPDATE 금지·1년 내 DELETE 금지)와 미등록 종류 거부가 유지된다", () => {
  const raw = new Database(DB);
  try {
    // 두 번째 기동이 다시 재빌드하지 않아야 한다(트리거는 initSchema 말미 재생성)
    assert.throws(() => raw.prepare("UPDATE audit_logs SET entity_name = 'x' WHERE id = 1").run(), /append-only/);
    assert.throws(() => raw.prepare("DELETE FROM audit_logs WHERE id = 1").run(), /append-only/);
    assert.throws(() => raw.prepare("INSERT INTO audit_logs (entity_type, action) VALUES ('nope','create')").run(), /CHECK constraint/);
  } finally {
    raw.close();
  }
});

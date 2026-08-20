// tests/audit.test.ts — 감사 로그 diff 기록(인메모리 SQLite) 단위테스트
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { logAudit, logAssetChange } from "../src/lib/audit.ts";

/** audit_logs 최소 스키마 인메모리 DB 생성 */
function makeDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      entity_name TEXT NOT NULL,
      action TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      changed_fields TEXT,
      old_values TEXT,
      new_values TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);
  return db;
}

function rows(db: InstanceType<typeof Database>): any[] {
  return db.prepare("SELECT * FROM audit_logs ORDER BY id").all();
}

test("update: 변경된 필드만 기록", () => {
  const db = makeDb();
  logAudit(db, {
    entityType: "asset",
    entityId: 1,
    entityName: "서버-1",
    action: "update",
    changedBy: "admin",
    oldData: { asset_name: "서버-1", status: "active", memo: "구형" },
    newData: { asset_name: "서버-1", status: "maintenance", memo: "구형" },
  });
  const all = rows(db);
  assert.equal(all.length, 1);
  const fields = JSON.parse(all[0].changed_fields);
  assert.deepEqual(fields, ["status"], "변경된 status만 기록");
  assert.deepEqual(JSON.parse(all[0].old_values), { status: "active" });
  assert.deepEqual(JSON.parse(all[0].new_values), { status: "maintenance" });
  assert.equal(all[0].action, "update");
  assert.equal(all[0].changed_by, "admin");
});

test("update: 무변경 시 행 미기록", () => {
  const db = makeDb();
  logAudit(db, {
    entityType: "asset",
    entityId: 1,
    entityName: "서버-1",
    action: "update",
    changedBy: "admin",
    oldData: { asset_name: "서버-1", status: "active" },
    newData: { asset_name: "서버-1", status: "active" },
  });
  assert.equal(rows(db).length, 0);
});

test("update: null ↔ 빈 문자열은 무변경으로 취급(String(x ?? '') 비교)", () => {
  const db = makeDb();
  logAudit(db, {
    entityType: "asset",
    entityId: 1,
    entityName: "서버-1",
    action: "update",
    changedBy: "admin",
    oldData: { memo: null },
    newData: { memo: "" },
  });
  assert.equal(rows(db).length, 0);
});

test("update: 숫자 → 문자열 동일값은 무변경(문자열 비교)", () => {
  const db = makeDb();
  logAudit(db, {
    entityType: "asset",
    entityId: 1,
    entityName: "서버-1",
    action: "update",
    changedBy: "admin",
    oldData: { rack_unit_start: 5 },
    newData: { rack_unit_start: "5" },
  });
  assert.equal(rows(db).length, 0);
});

test("create: 전체 필드 기록, old_values는 비어 있음", () => {
  const db = makeDb();
  logAudit(db, {
    entityType: "rack",
    entityId: 2,
    entityName: "A-01",
    action: "create",
    changedBy: "admin",
    newData: { rack_name: "A-01", total_units: 42 },
  });
  const all = rows(db);
  assert.equal(all.length, 1);
  assert.deepEqual(JSON.parse(all[0].changed_fields).sort(), ["rack_name", "total_units"]);
  assert.deepEqual(JSON.parse(all[0].old_values), {});
  assert.deepEqual(JSON.parse(all[0].new_values), { rack_name: "A-01", total_units: 42 });
});

test("delete: 삭제 시점 전체 필드가 old_values에 남음", () => {
  const db = makeDb();
  logAudit(db, {
    entityType: "asset",
    entityId: 3,
    entityName: "서버-3",
    action: "delete",
    changedBy: "admin",
    oldData: { asset_name: "서버-3", status: "retired" },
  });
  const all = rows(db);
  assert.equal(all.length, 1);
  assert.deepEqual(JSON.parse(all[0].old_values), { asset_name: "서버-3", status: "retired" });
  assert.deepEqual(JSON.parse(all[0].new_values), {});
});

test("logAssetChange 래퍼: entity_type=asset으로 위임", () => {
  const db = makeDb();
  logAssetChange(db, {
    assetId: 9,
    assetName: "서버-9",
    action: "update",
    changedBy: "team1",
    oldData: { memo: "a" },
    newData: { memo: "b" },
  });
  const all = rows(db);
  assert.equal(all.length, 1);
  assert.equal(all[0].entity_type, "asset");
  assert.equal(all[0].entity_id, 9);
  assert.deepEqual(JSON.parse(all[0].changed_fields), ["memo"]);
});

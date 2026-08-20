// tests/import-rollback.test.ts — 임포트 배치 롤백(인메모리 SQLite) 단위테스트
// 검증 계약: ① preview 집계(생성/수정/연결/이슈)가 실제와 일치 ② 롤백은 배치 생성분만 전량 삭제
// ③ 배치 open 이슈 자동 'ignored' ④ 감사 delete 기록 ⑤ 재롤백은 0건(멱등 실패)
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { rollbackPreview, rollbackBatch } from "../src/lib/import-rollback.ts";

function makeDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_type TEXT DEFAULT 'server',
      asset_name TEXT NOT NULL,
      serial_number TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      rack_id INTEGER,
      team_id INTEGER,
      import_batch_id TEXT,
      created_at TEXT DEFAULT '2026-01-01 00:00:00',
      updated_at TEXT DEFAULT '2026-01-01 00:00:00'
    );
    CREATE TABLE contract_assets (contract_id INTEGER, asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE);
    CREATE TABLE asset_ips (id INTEGER PRIMARY KEY, asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE, ip_address TEXT);
    CREATE TABLE inventory_audit_checks (id INTEGER PRIMARY KEY, audit_id INTEGER, asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE);
    CREATE TABLE sub_assets (id INTEGER PRIMARY KEY, sub_name TEXT, parent_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL);
    CREATE TABLE import_issue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
      issue_type TEXT DEFAULT 'ip_format',
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')),
      resolved_by TEXT DEFAULT '',
      resolved_at TEXT DEFAULT ''
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      entity_name TEXT NOT NULL,
      action TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      changed_fields TEXT, old_values TEXT, new_values TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
  db.pragma("foreign_keys = ON");
  return db;
}

const BATCH = "up-1700000000000";

function seedBatch(db: InstanceType<typeof Database>) {
  const ins = db.prepare("INSERT INTO assets (asset_name, serial_number, import_batch_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
  const a1 = Number(ins.run("배치-A", "S1", BATCH, "2026-01-01 00:00:00", "2026-01-01 00:00:00").lastInsertRowid);
  const a2 = Number(ins.run("배치-B", "S2", BATCH, "2026-01-01 00:00:00", "2026-01-02 09:00:00").lastInsertRowid); // 임포트 후 수정됨
  const a3 = Number(ins.run("배치-C", "S3", BATCH, "2026-01-01 00:00:00", "2026-01-01 00:00:00").lastInsertRowid);
  // 배치 밖 자산 (롤백 영향권 밖이어야 함)
  const other = Number(ins.run("기존-Z", "S9", null, "2025-01-01 00:00:00", "2025-01-01 00:00:00").lastInsertRowid);
  // 연결관계: a2에 계약, a3에 부속 연결 → linked 자산 수 = 2
  db.prepare("INSERT INTO contract_assets (contract_id, asset_id) VALUES (1, ?)").run(a2);
  db.prepare("INSERT INTO sub_assets (sub_name, parent_asset_id) VALUES ('모니터', ?)").run(a3);
  // 정리큐: open 2건 + resolved 1건 + 타배치 open 1건
  const issue = db.prepare("INSERT INTO import_issue (batch_id, asset_id, status) VALUES (?, ?, ?)");
  issue.run(BATCH, a1, "open");
  issue.run(BATCH, a2, "open");
  issue.run(BATCH, a3, "resolved");
  issue.run("up-999", other, "open");
  return { a1, a2, a3, other };
}

test("preview: 생성/수정/연결/이슈 집계가 정확하다", () => {
  const db = makeDb();
  seedBatch(db);
  const pv = rollbackPreview(db, BATCH);
  assert.ok(pv);
  assert.equal(pv.total, 3);        // 배치 생성 3 (기존-Z 제외)
  assert.equal(pv.modified, 1);     // a2만 updated_at ≠ created_at
  assert.equal(pv.linked, 2);       // a2(계약) + a3(부속)
  assert.equal(pv.open_issues, 2);  // 배치의 open만 (resolved·타배치 제외)
});

test("preview: 없는 배치는 null", () => {
  const db = makeDb();
  seedBatch(db);
  assert.equal(rollbackPreview(db, "up-000"), null);
});

test("롤백: 배치 생성분만 전량 삭제, 배치 밖 자산은 보존", () => {
  const db = makeDb();
  const { other } = seedBatch(db);
  const deleted = rollbackBatch(db, BATCH, "admin");
  assert.equal(deleted, 3);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM assets WHERE import_batch_id = ?").get(BATCH) as any).c, 0);
  assert.ok(db.prepare("SELECT id FROM assets WHERE id = ?").get(other), "배치 밖 자산은 남아야 한다");
});

test("롤백: 배치 open 이슈만 ignored로 자동 정리 (resolved·타배치 불변)", () => {
  const db = makeDb();
  seedBatch(db);
  rollbackBatch(db, BATCH, "admin");
  const byStatus = (s: string, b: string) =>
    (db.prepare("SELECT COUNT(*) c FROM import_issue WHERE batch_id = ? AND status = ?").get(b, s) as any).c;
  assert.equal(byStatus("open", BATCH), 0);
  assert.equal(byStatus("ignored", BATCH), 2);
  assert.equal(byStatus("resolved", BATCH), 1, "이미 조치완료된 이슈는 건드리지 않는다");
  assert.equal(byStatus("open", "up-999"), 1, "타배치 이슈는 불변");
  const ignored = db.prepare("SELECT resolved_by, note FROM import_issue WHERE batch_id = ? AND status = 'ignored'").all(BATCH) as any[];
  for (const r of ignored) {
    assert.equal(r.resolved_by, "admin");
    assert.ok(r.note.includes("배치 롤백"), "자동 정리 사유가 note에 남아야 한다");
  }
});

test("롤백: 자산별 delete 감사 기록 + 원인(_cause) 포함", () => {
  const db = makeDb();
  seedBatch(db);
  rollbackBatch(db, BATCH, "admin");
  const logs = db.prepare("SELECT * FROM audit_logs WHERE action = 'delete'").all() as any[];
  assert.equal(logs.length, 3);
  for (const l of logs) {
    assert.equal(l.changed_by, "admin");
    assert.ok(String(l.old_values).includes("임포트 배치 롤백"), "_cause가 old_values에 남아야 한다");
  }
});

test("롤백: FK 연쇄 — 부속 연결은 SET NULL, 계약 연결은 제거", () => {
  const db = makeDb();
  seedBatch(db);
  rollbackBatch(db, BATCH, "admin");
  assert.equal((db.prepare("SELECT parent_asset_id FROM sub_assets WHERE sub_name = '모니터'").get() as any).parent_asset_id, null);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM contract_assets").get() as any).c, 0);
});

test("재롤백: 대상 없음 → 0건, 쓰기 없음(멱등)", () => {
  const db = makeDb();
  seedBatch(db);
  rollbackBatch(db, BATCH, "admin");
  const logsBefore = (db.prepare("SELECT COUNT(*) c FROM audit_logs").get() as any).c;
  assert.equal(rollbackBatch(db, BATCH, "admin"), 0);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM audit_logs").get() as any).c, logsBefore, "재롤백은 감사 기록을 추가하지 않는다");
});

test("preview와 실삭제 건수 일치 (검수 특약 계약)", () => {
  const db = makeDb();
  seedBatch(db);
  const pv = rollbackPreview(db, BATCH)!;
  assert.equal(rollbackBatch(db, BATCH, "admin"), pv.total);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { logAudit } from "../src/lib/audit.ts";

function makeDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      team_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE vendors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_name TEXT NOT NULL
    );
    CREATE TABLE maintenance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
      asset_name TEXT DEFAULT '',
      log_type TEXT DEFAULT 'failure',
      occurred_at TEXT DEFAULT '',
      resolved_at TEXT DEFAULT '',
      reported_by TEXT DEFAULT '',
      handled_by TEXT DEFAULT '',
      severity TEXT DEFAULT 'minor',
      symptom TEXT DEFAULT '',
      action_taken TEXT DEFAULT '',
      vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
      cost TEXT DEFAULT '',
      status TEXT DEFAULT 'open',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE maintenance_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
      asset_name TEXT DEFAULT '',
      system_name TEXT DEFAULT '',
      category TEXT DEFAULT '',
      asset_type_label TEXT DEFAULT '',
      resource_name TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      manufacturer TEXT DEFAULT '',
      host_name TEXT DEFAULT '',
      purpose TEXT DEFAULT '',
      location_text TEXT DEFAULT '',
      rack_position TEXT DEFAULT '',
      asset_code TEXT DEFAULT '',
      owner_department TEXT DEFAULT '',
      owner_user TEXT DEFAULT '',
      acquisition_date TEXT DEFAULT '',
      acquisition_amount TEXT DEFAULT '',
      maintenance_start TEXT DEFAULT '',
      maintenance_end TEXT DEFAULT '',
      maintenance_months INTEGER DEFAULT 0,
      business_impact TEXT DEFAULT '',
      data_importance TEXT DEFAULT '',
      user_traffic TEXT DEFAULT '',
      hardware_score TEXT DEFAULT '',
      maintenance_difficulty TEXT DEFAULT '',
      maintenance_scope TEXT DEFAULT '',
      score_total TEXT DEFAULT '',
      grade TEXT DEFAULT '',
      rate TEXT DEFAULT '',
      estimated_amount_calc TEXT DEFAULT '',
      estimated_amount_input TEXT DEFAULT '',
      evidence_note TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      updated_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
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
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
  db.pragma("foreign_keys = ON");
  return db;
}

function createTarget(db: InstanceType<typeof Database>, patch: Partial<Record<string, any>> = {}) {
  const assetId = Number(db.prepare("INSERT INTO assets (asset_name, team_id) VALUES ('메일서버', 1)").run().lastInsertRowid);
  const base = {
    asset_id: assetId,
    asset_name: "메일서버",
    system_name: "공용센터",
    category: "서버",
    asset_type_label: "IBM",
    resource_name: "IBM X3650",
    quantity: 1,
    manufacturer: "IBM",
    host_name: "mail-01",
    purpose: "메일 서비스",
    location_text: "본원 / 전산실 / 2층",
    rack_position: "EL-C05-9",
    asset_code: "ASSET-0001",
    owner_department: "운영팀",
    owner_user: "홍길동",
    acquisition_date: "2011-12-30",
    acquisition_amount: "18666668",
    maintenance_start: "2025-01-01",
    maintenance_end: "2025-12-31",
    maintenance_months: 12,
    business_impact: "40",
    data_importance: "4",
    user_traffic: "5",
    hardware_score: "90",
    maintenance_difficulty: "60",
    maintenance_scope: "25",
    score_total: "72",
    grade: "4",
    rate: "7",
    estimated_amount_calc: "1306667",
    estimated_amount_input: "1306667",
    evidence_note: "산정표",
    notes: "",
    created_by: "admin",
    updated_by: "admin",
    ...patch,
  };
  const cols = Object.keys(base);
  const result = db.prepare(`INSERT INTO maintenance_targets (${cols.join(",")}) VALUES (${cols.map((c) => `@${c}`).join(",")})`).run(base);
  return { id: Number(result.lastInsertRowid), assetId };
}

test("maintenance target: 엑셀 산정 컬럼을 그대로 저장한다", () => {
  const db = makeDb();
  const { id } = createTarget(db, { estimated_amount_input: "2002000", maintenance_scope: "25" });
  const row = db.prepare("SELECT * FROM maintenance_targets WHERE id = ?").get(id) as any;
  assert.equal(row.system_name, "공용센터");
  assert.equal(row.resource_name, "IBM X3650");
  assert.equal(row.asset_code, "ASSET-0001");
  assert.equal(row.maintenance_start, "2025-01-01");
  assert.equal(row.maintenance_end, "2025-12-31");
  assert.equal(row.maintenance_months, 12);
  assert.equal(row.score_total, "72");
  assert.equal(row.estimated_amount_input, "2002000");
});

test("maintenance target: 자산 삭제 후에도 스냅샷 이름은 남고 FK는 NULL 된다", () => {
  const db = makeDb();
  const { id, assetId } = createTarget(db);
  db.prepare("DELETE FROM assets WHERE id = ?").run(assetId);
  const row = db.prepare("SELECT asset_id, asset_name FROM maintenance_targets WHERE id = ?").get(id) as any;
  assert.equal(row.asset_id, null);
  assert.equal(row.asset_name, "메일서버");
});

test("maintenance log: 자산명 스냅샷 보존 + 감사로그에서 target/log를 구분한다", () => {
  const db = makeDb();
  const { id } = createTarget(db);
  const assetId = (db.prepare("SELECT asset_id FROM maintenance_targets WHERE id = ?").get(id) as any).asset_id;
  const logId = Number(db.prepare(`
    INSERT INTO maintenance_logs (asset_id, asset_name, log_type, occurred_at, severity, symptom, status, reported_by)
    VALUES (?, ?, 'failure', '2025-07-07T10:00', 'major', '디스크 경고', 'open', 'admin')
  `).run(assetId, "메일서버").lastInsertRowid);

  logAudit(db, {
    entityType: "maintenance",
    entityId: id,
    entityName: "IBM X3650",
    action: "create",
    changedBy: "admin",
    newData: { record_kind: "target", asset_code: "ASSET-0001" },
  });
  logAudit(db, {
    entityType: "maintenance",
    entityId: logId,
    entityName: "메일서버",
    action: "create",
    changedBy: "admin",
    newData: { record_kind: "log", log_type: "failure" },
  });

  db.prepare("DELETE FROM assets WHERE id = ?").run(assetId);
  const logRow = db.prepare("SELECT asset_id, asset_name FROM maintenance_logs WHERE id = ?").get(logId) as any;
  assert.equal(logRow.asset_id, null);
  assert.equal(logRow.asset_name, "메일서버");

  const audits = db.prepare("SELECT entity_name, new_values FROM audit_logs ORDER BY id").all() as any[];
  assert.equal(JSON.parse(audits[0].new_values).record_kind, "target");
  assert.equal(JSON.parse(audits[1].new_values).record_kind, "log");
});

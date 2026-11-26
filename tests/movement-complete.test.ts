// tests/movement-complete.test.ts — 반입 완료(직접입력 장비) → 자산 대장 자동 등록 회귀 방지.
// 재현 버그: assets.department 컬럼 제거(ADR-009) 뒤에도 INSERT 가 department 를 써서 완료 처리가 500 으로 실패했다.
// 실제 스키마 마이그레이션을 거친 임시 DB 에 대고 lib 함수를 그대로 실행한다.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MovementRow } from "../src/lib/db-types.ts";

const dir = mkdtempSync(join(tmpdir(), "asset-movement-"));
process.env.ASSET_DB_PATH = join(dir, "test.db");

// getDb 는 DB_PATH 를 import 시점에 계산하므로 env 설정 후 동적 import
const { getDb } = await import("../src/lib/db.ts");
const { registerBroughtInAsset } = await import("../src/lib/movement-complete.ts");

const db = getDb();

after(() => {
  try { db.close(); } catch { /* noop */ }
  rmSync(dir, { recursive: true, force: true });
});

function insertBringIn(fields: Partial<MovementRow>): MovementRow {
  const id = Number(db.prepare(`
    INSERT INTO asset_movements (movement_type, status, department, equipment_desc, model, manufacturer,
      serial_number, size_u, purpose, power_watts, power_redundant, rack_position, notes)
    VALUES ('bring_in', 'approved', @department, @equipment_desc, @model, @manufacturer,
      @serial_number, @size_u, @purpose, @power_watts, @power_redundant, @rack_position, @notes)
  `).run({
    department: "", equipment_desc: "", model: "", manufacturer: "", serial_number: "", size_u: "",
    purpose: "", power_watts: "", power_redundant: "", rack_position: "", notes: "",
    ...fields,
  }).lastInsertRowid);
  return db.prepare("SELECT * FROM asset_movements WHERE id = ?").get(id) as MovementRow;
}

test("assets 에 department 컬럼이 없다(소유 정본은 team_id) — 이 테스트의 전제", () => {
  const cols = (db.prepare("PRAGMA table_info(assets)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(!cols.includes("department"));
  assert.ok(cols.includes("team_id"));
});

test("신청 부서명이 팀과 일치하면 그 팀 소유로 등록하고 반출입 건에 자산을 연결한다", () => {
  const teamId = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('정보운영과')").run().lastInsertRowid);
  const m = insertBringIn({
    department: " 정보운영과 ", equipment_desc: "신규 웹서버", model: "R760", manufacturer: "Dell",
    serial_number: "SN-1", size_u: "2U", purpose: "웹 증설", power_watts: "800W", power_redundant: "yes",
    rack_position: "A-01 10U", notes: "긴급",
  });

  const assetId = registerBroughtInAsset(db, m, "admin");

  const a = db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId) as Record<string, unknown>;
  assert.equal(a.asset_name, "신규 웹서버");
  assert.equal(a.asset_type, "other");
  assert.equal(a.status, "active");
  assert.equal(a.team_id, teamId);
  assert.equal(a.rack_unit_size, 2);
  assert.equal(a.manufacturer, "Dell");
  assert.equal(a.serial_number, "SN-1");
  assert.equal(a.description, "웹 증설 · 소비전력 800W · 전원 이중화 · 반입 희망 랙위치 A-01 10U · 긴급");
  const linked = db.prepare("SELECT asset_id FROM asset_movements WHERE id = ?").get(m.id) as { asset_id: number };
  assert.equal(linked.asset_id, assetId);
  const log = db.prepare("SELECT action, entity_type FROM audit_logs WHERE entity_type = 'asset' AND entity_id = ?").get(assetId) as { action: string } | undefined;
  assert.equal(log?.action, "create");
});

test("일치하는 팀이 없으면 미배정(team_id NULL)으로 등록하고 팀을 새로 만들지 않는다", () => {
  const teamsBefore = (db.prepare("SELECT COUNT(*) AS c FROM teams").get() as { c: number }).c;
  const m = insertBringIn({ department: "없는부서", model: "X1", size_u: "abc" });

  const assetId = registerBroughtInAsset(db, m, "admin");

  const a = db.prepare("SELECT asset_name, team_id, rack_unit_size FROM assets WHERE id = ?").get(assetId) as { asset_name: string; team_id: number | null; rack_unit_size: number };
  assert.equal(a.team_id, null);
  assert.equal(a.asset_name, "X1", "품목 미기재 → 모델명");
  assert.equal(a.rack_unit_size, 1, "해석 불가 크기 → 1U");
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM teams").get() as { c: number }).c, teamsBefore);
});

test("품목·모델 모두 비면 '반입 장비' 이름으로 등록한다", () => {
  const m = insertBringIn({});
  const assetId = registerBroughtInAsset(db, m, "admin");
  const a = db.prepare("SELECT asset_name FROM assets WHERE id = ?").get(assetId) as { asset_name: string };
  assert.equal(a.asset_name, "반입 장비");
});

test("트랜잭션 안에서 실패하면 반출입 상태 변경도 함께 되돌린다(부분 커밋 방지)", () => {
  const m = insertBringIn({ equipment_desc: "롤백 대상" });
  const assetsBefore = (db.prepare("SELECT COUNT(*) AS c FROM assets").get() as { c: number }).c;
  assert.throws(() => db.transaction(() => {
    db.prepare("UPDATE asset_movements SET status = 'completed' WHERE id = ?").run(m.id);
    registerBroughtInAsset(db, m, "admin");
    throw new Error("후속처리 실패 시뮬레이션");
  })());
  const after = db.prepare("SELECT status, asset_id FROM asset_movements WHERE id = ?").get(m.id) as { status: string; asset_id: number | null };
  assert.equal(after.status, "approved");
  assert.equal(after.asset_id, null);
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM assets").get() as { c: number }).c, assetsBefore);
});

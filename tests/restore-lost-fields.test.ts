// tests/restore-lost-fields.test.ts — scripts/deploy/restore-lost-fields.cjs (재기동 유실 값 복구)
// 실제 라우트가 쓰는 감사 기록 함수(reassignUnassignedAssets·logAssetChange)로 이력을 만든 뒤
// 결함과 같은 방식(값 NULL/'')으로 지우고, 복구 계획·적용·멱등·안전 규칙을 검증한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { planRestore, applyRestore } = require("../scripts/deploy/restore-lost-fields.cjs") as {
  planRestore: (db: unknown) => { id: number; asset_name: string; set: Record<string, unknown> }[];
  applyRestore: (db: unknown, plan: unknown) => number;
};

const dir = mkdtempSync(join(tmpdir(), "asset-restore-"));
process.env.ASSET_DB_PATH = join(dir, "restore.db");

type Db = import("better-sqlite3").Database;
let db: Db;
let ids: Record<string, number> = {};
let teamA = 0, teamGone = 0, rack1 = 0, rack2 = 0;

before(async () => {
  const { getDb } = await import("../src/lib/db.ts");
  const { reassignUnassignedAssets } = await import("../src/lib/asset-reassign.ts");
  const { logAssetChange } = await import("../src/lib/audit.ts");
  db = getDb();
  teamA = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('운영팀')").run().lastInsertRowid);
  teamGone = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('해체팀')").run().lastInsertRowid);
  const loc = Number(db.prepare("INSERT INTO locations (location_name) VALUES ('전산실')").run().lastInsertRowid);
  rack1 = Number(db.prepare("INSERT INTO racks (location_id, rack_name) VALUES (?, 'R1')").run(loc).lastInsertRowid);
  rack2 = Number(db.prepare("INSERT INTO racks (location_id, rack_name) VALUES (?, 'R2')").run(loc).lastInsertRowid);
  const mk = (name: string, extra = "") =>
    Number(db.prepare(`INSERT INTO assets (asset_type, asset_name${extra ? ", rack_id, rack_unit_start" : ""}) VALUES ('server', ?${extra ? ", ?, 10" : ""})`)
      .run(...(extra ? [name, rack1] : [name])).lastInsertRowid);
  for (const n of ["team", "side", "moved", "verified", "batch", "cleared", "gone-team", "kept"]) ids[n] = mk(n, ["side", "moved"].includes(n) ? "rack" : "");

  // 소유 팀 재배정 (미배정 → 운영팀) — reassign 라우트와 동일 함수
  reassignUnassignedAssets(db, { assetIds: [ids.team, ids.cleared, ids.kept], teamId: teamA, actorUsername: "admin" });
  reassignUnassignedAssets(db, { assetIds: [ids["gone-team"]], teamId: teamGone, actorUsername: "admin" });
  // 반폭 배치 (rack 라우트: 위치 4필드 함께 기록)
  for (const k of ["side", "moved"]) {
    db.prepare("UPDATE assets SET rack_side='L' WHERE id=?").run(ids[k]);
    logAssetChange(db, { assetId: ids[k], assetName: k, action: "update", changedBy: "admin",
      oldData: { rack_id: rack1, rack_unit_start: 10, rack_unit_size: 1, rack_side: null },
      newData: { rack_id: rack1, rack_unit_start: 10, rack_unit_size: 1, rack_side: "L" } });
  }
  // 'moved' 는 그 뒤 다른 랙으로 이동(일반 수정 — 바뀐 필드만 기록)
  db.prepare("UPDATE assets SET rack_id=? WHERE id=?").run(rack2, ids.moved);
  logAssetChange(db, { assetId: ids.moved, assetName: "moved", action: "update", changedBy: "admin",
    oldData: { rack_id: rack1, asset_name: "moved" }, newData: { rack_id: rack2, asset_name: "moved" } });
  // 현행 확인 도장 (verify 라우트와 동일 페이로드)
  db.prepare("UPDATE assets SET verified_at='2026-09-20 10:00:00', verified_by='kim' WHERE id=?").run(ids.verified);
  logAssetChange(db, { assetId: ids.verified, assetName: "verified", action: "update", changedBy: "kim",
    oldData: { verified_at: "" }, newData: { verified_at: "2026-09-20 10:00:00", verified_by: "kim", _cause: "현행 확인" } });
  // 일괄등록 생성 (import 라우트: create + import_batch_id)
  db.prepare("UPDATE assets SET import_batch_id='up-777' WHERE id=?").run(ids.batch);
  logAssetChange(db, { assetId: ids.batch, assetName: "batch", action: "create", changedBy: "admin",
    newData: { asset_name: "batch", import_batch_id: "up-777" } });
  // 'cleared' 는 이후 운영자가 소유 팀을 명시 해제(일괄수정 team_id=null) — 복구하면 안 된다
  db.prepare("UPDATE assets SET team_id=NULL WHERE id=?").run(ids.cleared);
  logAssetChange(db, { assetId: ids.cleared, assetName: "cleared", action: "update", changedBy: "admin",
    oldData: { team_id: teamA }, newData: { team_id: null } });

  // 결함 재현: 재기동이 5개 값을 비운다. 'kept' 는 유실 후 운영자가 이미 다른 팀으로 다시 지정 → 덮어쓰면 안 된다
  db.exec("UPDATE assets SET team_id=NULL, rack_side=NULL, import_batch_id=NULL, verified_at='', verified_by=''");
  db.prepare("UPDATE assets SET team_id=? WHERE id=?").run(teamGone, ids.kept);
});

after(() => {
  try { db.close(); } catch { /* noop */ }
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); } catch { /* Windows WAL 잠금 잔여 */ }
});

test("계획: 마지막 기록값으로 빈 필드만 채운다", () => {
  const plan = planRestore(db);
  const by = Object.fromEntries(plan.map((p) => [p.asset_name, p.set]));
  assert.deepEqual(by.team, { team_id: teamA });
  assert.deepEqual(by.side, { rack_side: "L" });
  assert.deepEqual(by.verified, { verified_at: "2026-09-20 10:00:00", verified_by: "kim" });
  assert.deepEqual(by.batch, { import_batch_id: "up-777" });
  assert.deepEqual(by["gone-team"], { team_id: teamGone });
});

test("안전 규칙: 이동한 자산의 L/R·명시 해제·현재 값이 있는 필드는 건드리지 않는다", () => {
  const names = new Set(planRestore(db).map((p) => p.asset_name));
  assert.ok(!names.has("moved"), "랙 이동 후 L/R 복구 금지");
  assert.ok(!names.has("cleared"), "마지막 기록이 해제면 복구 금지");
  assert.ok(!names.has("kept"), "운영자가 다시 지정한 값 보존");
});

test("존재하지 않는 팀은 복구하지 않는다", () => {
  // 팀 해체: 참조를 풀고 삭제. 'kept' 는 빈 값이 되므로 자기 마지막 기록(운영팀)으로 복구 대상이 된다.
  db.prepare("UPDATE assets SET team_id=NULL WHERE team_id=?").run(teamGone);
  db.prepare("DELETE FROM teams WHERE id=?").run(teamGone);
  const by = Object.fromEntries(planRestore(db).map((p) => [p.asset_name, p.set]));
  assert.equal(by["gone-team"], undefined, "해체된 팀으로 복구 금지");
  assert.deepEqual(by.kept, { team_id: teamA });
});

test("적용: 값 복원 + 자산별 감사로그 1행, 재실행은 0건(멱등)", () => {
  const plan = planRestore(db);
  const auditBefore = (db.prepare("SELECT COUNT(*) c FROM audit_logs").get() as { c: number }).c;
  assert.equal(applyRestore(db, plan), plan.length);
  const row = db.prepare("SELECT team_id, rack_side, verified_at, verified_by, import_batch_id FROM assets WHERE id IN (?,?,?,?) ORDER BY id")
    .all(ids.team, ids.side, ids.verified, ids.batch) as Record<string, unknown>[];
  assert.equal(row[0].team_id, teamA);
  assert.equal(row[1].rack_side, "L");
  assert.equal(row[2].verified_by, "kim");
  assert.equal(row[3].import_batch_id, "up-777");
  const audits = db.prepare("SELECT changed_by, new_values FROM audit_logs WHERE id > (SELECT MAX(id) FROM audit_logs) - ?").all(plan.length) as { changed_by: string; new_values: string }[];
  assert.equal((db.prepare("SELECT COUNT(*) c FROM audit_logs").get() as { c: number }).c, auditBefore + plan.length);
  assert.ok(audits.every((a) => a.changed_by === "system:restore-lost-fields" && JSON.parse(a.new_values)._cause));
  assert.deepEqual(planRestore(db), [], "재실행 시 채울 것 없음");
});

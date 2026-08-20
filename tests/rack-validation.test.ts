// tests/rack-validation.test.ts — 랙 배치 검증(인메모리 SQLite) 단위테스트
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { validateRackPlacement } from "../src/lib/rack-validation.ts";

// rackSide 인자 지원 여부 감지 — (db, rackId, unitStart, unitSize, excludeAssetId?, rackSide?) 형태면 length 6
// (strip-types 후 optional 파라미터도 기본값이 없으므로 length에 포함됨)
const SUPPORTS_SIDE = validateRackPlacement.length >= 6;

/** racks/assets 최소 스키마(rack_side 포함) 인메모리 DB 생성 */
function makeDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE racks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rack_name TEXT NOT NULL,
      total_units INTEGER NOT NULL DEFAULT 42
    );
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_name TEXT NOT NULL,
      rack_id INTEGER,
      rack_unit_start INTEGER,
      rack_unit_size INTEGER NOT NULL DEFAULT 1,
      rack_side TEXT CHECK(rack_side IN ('L','R'))
    );
  `);
  db.prepare("INSERT INTO racks (rack_name, total_units) VALUES ('A-01', 42)").run();
  return db;
}

function insertAsset(db: InstanceType<typeof Database>, name: string, start: number, size: number, side: "L" | "R" | null = null): number {
  const r = db.prepare(
    "INSERT INTO assets (asset_name, rack_id, rack_unit_start, rack_unit_size, rack_side) VALUES (?, 1, ?, ?, ?)"
  ).run(name, start, size, side);
  return Number(r.lastInsertRowid);
}

test("정상 배치: 빈 랙에 1~2U 배치 허용", () => {
  const db = makeDb();
  assert.equal(validateRackPlacement(db, 1, 1, 2), null);
});

test("미설치(rackId null)는 검증 통과", () => {
  const db = makeDb();
  assert.equal(validateRackPlacement(db, null, null, 1), null);
});

test("존재하지 않는 랙 거부", () => {
  const db = makeDb();
  const msg = validateRackPlacement(db, 999, 1, 1);
  assert.ok(msg && msg.includes("존재하지 않습니다"));
});

test("시작 U 미지정/0 이하 거부", () => {
  const db = makeDb();
  assert.ok(validateRackPlacement(db, 1, null, 1));
  assert.ok(validateRackPlacement(db, 1, 0, 1));
});

test("크기 1 미만 거부", () => {
  const db = makeDb();
  assert.ok(validateRackPlacement(db, 1, 1, 0));
});

test("범위 초과: 42U 랙에 41~43U 배치 거부", () => {
  const db = makeDb();
  const msg = validateRackPlacement(db, 1, 41, 3);
  assert.ok(msg && msg.includes("초과"));
});

test("범위 경계: 41~42U(end == total_units)는 허용", () => {
  const db = makeDb();
  assert.equal(validateRackPlacement(db, 1, 41, 2), null);
});

test("겹침 거부: 기존 5~8U와 8~9U 신규 배치 충돌(경계 공유)", () => {
  const db = makeDb();
  insertAsset(db, "서버-1", 5, 4); // 5~8U 전폭
  const msg = validateRackPlacement(db, 1, 8, 2);
  assert.ok(msg && msg.includes("슬롯 충돌"));
});

test("비겹침: 기존 5~8U와 9~10U 신규 배치 허용", () => {
  const db = makeDb();
  insertAsset(db, "서버-1", 5, 4);
  assert.equal(validateRackPlacement(db, 1, 9, 2), null);
});

test("자기 자신 제외: 동일 자산 재저장(PUT) 시 자기 구간과 충돌하지 않음", () => {
  const db = makeDb();
  const id = insertAsset(db, "서버-1", 5, 4);
  assert.ok(validateRackPlacement(db, 1, 5, 4), "제외 없이는 충돌");
  assert.equal(validateRackPlacement(db, 1, 5, 4, id), null, "excludeAssetId로 자기 자신 제외");
});

test("겹침 메시지에 타팀 자산명 비노출(U-구간만 표기)", () => {
  const db = makeDb();
  insertAsset(db, "기밀서버-X", 5, 4);
  const msg = validateRackPlacement(db, 1, 6, 1);
  assert.ok(msg && !msg.includes("기밀서버-X"), "자산명이 오류 메시지에 노출되면 안 된다");
});

// ── 반폭(rack_side) 케이스 — 시그니처에 rackSide 인자가 있을 때만 실행 ──
test("반폭 허용: 기존 L 반폭과 같은 구간에 R 반폭 배치", { skip: !SUPPORTS_SIDE }, () => {
  const db = makeDb();
  insertAsset(db, "스위치-L", 10, 1, "L");
  assert.equal(validateRackPlacement(db, 1, 10, 1, undefined, "R"), null);
});

test("반폭 충돌: 같은 구간 L-L은 거부", { skip: !SUPPORTS_SIDE }, () => {
  const db = makeDb();
  insertAsset(db, "스위치-L", 10, 1, "L");
  const msg = validateRackPlacement(db, 1, 10, 1, undefined, "L");
  assert.ok(msg && msg.includes("슬롯 충돌"));
});

test("전폭 vs 반폭: 기존 L 반폭 구간에 전폭(null) 배치 거부", { skip: !SUPPORTS_SIDE }, () => {
  const db = makeDb();
  insertAsset(db, "스위치-L", 10, 1, "L");
  const msg = validateRackPlacement(db, 1, 10, 1, undefined, null);
  assert.ok(msg && msg.includes("슬롯 충돌"));
});

test("반폭 vs 전폭: 기존 전폭 구간에 반폭 배치 거부", { skip: !SUPPORTS_SIDE }, () => {
  const db = makeDb();
  insertAsset(db, "서버-전폭", 10, 2, null);
  const msg = validateRackPlacement(db, 1, 11, 1, undefined, "R");
  assert.ok(msg && msg.includes("슬롯 충돌"));
});
// ── 데이터 이상값 가드 (외부 검토 R2-2 합의): 기존 행의 rack_unit_size가 NULL/0이어도
// 겹침 SQL이 오판·오류 없이 동작해야 한다 (임포트 유래 이상값 방어) ──

function makeDbNullableSize(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE racks (id INTEGER PRIMARY KEY AUTOINCREMENT, rack_name TEXT NOT NULL, total_units INTEGER NOT NULL DEFAULT 42);
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_name TEXT NOT NULL,
      rack_id INTEGER,
      rack_unit_start INTEGER,
      rack_unit_size INTEGER,
      rack_side TEXT CHECK(rack_side IN ('L','R'))
    );
  `);
  db.prepare("INSERT INTO racks (rack_name, total_units) VALUES ('A-01', 42)").run();
  return db;
}

test("이상값 가드: 기존 행 size NULL은 겹침 판정에서 제외", () => {
  const db = makeDbNullableSize();
  db.prepare("INSERT INTO assets (asset_name, rack_id, rack_unit_start, rack_unit_size) VALUES ('이상-NULL', 1, 10, NULL)").run();
  assert.equal(validateRackPlacement(db, 1, 10, 1), null, "size NULL 행과는 충돌 판정하지 않는다");
});

test("이상값 가드: 기존 행 size 0도 겹침 판정에서 제외", () => {
  const db = makeDbNullableSize();
  db.prepare("INSERT INTO assets (asset_name, rack_id, rack_unit_start, rack_unit_size) VALUES ('이상-0', 1, 10, 0)").run();
  assert.equal(validateRackPlacement(db, 1, 10, 1), null);
});

test("이상값 가드: 기존 행 start NULL도 겹침 판정에서 제외", () => {
  const db = makeDbNullableSize();
  db.prepare("INSERT INTO assets (asset_name, rack_id, rack_unit_start, rack_unit_size) VALUES ('이상-미배치', 1, NULL, 2)").run();
  assert.equal(validateRackPlacement(db, 1, 1, 42), null);
});

test("이상값 가드: 정상 행과 이상 행이 섞여도 정상 행 충돌은 검출", () => {
  const db = makeDbNullableSize();
  db.prepare("INSERT INTO assets (asset_name, rack_id, rack_unit_start, rack_unit_size) VALUES ('이상-NULL', 1, 10, NULL)").run();
  db.prepare("INSERT INTO assets (asset_name, rack_id, rack_unit_start, rack_unit_size) VALUES ('정상', 1, 10, 2)").run();
  const msg = validateRackPlacement(db, 1, 11, 1);
  assert.ok(msg && msg.includes("슬롯 충돌"), "이상 행이 있어도 정상 행과의 충돌은 잡아야 한다");
});

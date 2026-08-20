// tests/infra-scope-db.test.ts — 부서 독립 운영(ADR-011) DB 통합 검증
// 실제 스키마 마이그레이션(team_id 컬럼 추가) + 하이브리드/소유 스코프 쿼리를 임시 DB로 검증한다.
// 재현 버그: "특정 팀 로그인 시 자기 팀과 무관한 공용센터의 랙들이 보인다" → 이 테스트가 회귀를 잡는다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// authz는 env에 의존하지 않으므로 정적 import (타입은 type-only import로 소거)
import { rackScopeWhere, locationScopeWhere, scopeWhere } from "../src/lib/authz.ts";
import type { Actor } from "../src/lib/authz.ts";

const dir = mkdtempSync(join(tmpdir(), "asset-infra-"));
process.env.ASSET_DB_PATH = join(dir, "test.db");

// getDb는 DB_PATH를 import 시점에 계산하므로 env 설정 후 동적 import 해야 한다
const { getDb } = await import("../src/lib/db.ts");

const db = getDb();

const teamA: Actor = { userId: 1, username: "a", role: "team", teamId: 0 };
const teamB: Actor = { userId: 2, username: "b", role: "team", teamId: 0 };
const admin: Actor = { userId: 3, username: "admin", role: "admin", teamId: null };

before(() => {
  // 팀 A(외부 IDC), 팀 B(공용센터 일부)
  const aId = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('A-IDC')").run().lastInsertRowid);
  const bId = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('B-KISARANG')").run().lastInsertRowid);
  teamA.teamId = aId;
  teamB.teamId = bId;

  // 위치: 공용센터(공유), A팀 외부 IDC(전용)
  const kisarang = Number(db.prepare("INSERT INTO locations (location_name) VALUES ('공용센터')").run().lastInsertRowid);
  const aIdc = Number(db.prepare("INSERT INTO locations (location_name, team_id) VALUES ('A외부IDC', ?)").run(aId).lastInsertRowid);

  // 랙:
  //  r_shared_empty : 공용센터 공유(NULL), 자산 없음 → 팀엔 안 보임(총괄 전용), 이것이 버그의 핵심
  //  r_shared_bAsset: 공용센터 공유(NULL), B팀 자산 있음 → B에게만 파생 노출
  //  r_a_dedicated  : A팀 전용(team_id=A), 비어있어도 A에게 보임
  const rSharedEmpty = Number(db.prepare("INSERT INTO racks (location_id, rack_name, total_units) VALUES (?, 'KS-EMPTY', 42)").run(kisarang).lastInsertRowid);
  const rSharedB = Number(db.prepare("INSERT INTO racks (location_id, rack_name, total_units) VALUES (?, 'KS-B', 42)").run(kisarang).lastInsertRowid);
  const rADedicated = Number(db.prepare("INSERT INTO racks (location_id, rack_name, total_units, team_id) VALUES (?, 'A-RACK', 42, ?)").run(aIdc, aId).lastInsertRowid);

  // B팀 자산을 공유 랙에 배치
  db.prepare(
    "INSERT INTO assets (asset_type, asset_name, team_id, rack_id, rack_unit_start, rack_unit_size) VALUES ('server','B-SRV',?,?,1,1)"
  ).run(bId, rSharedB);

  // 소유 전용 테이블: 대역/배선/계약을 A/B로 나눔
  db.prepare("INSERT INTO ip_subnets (subnet_name, network_address, team_id) VALUES ('A-net','10.0.0.0',?)").run(aId);
  db.prepare("INSERT INTO ip_subnets (subnet_name, network_address, team_id) VALUES ('B-net','10.0.1.0',?)").run(bId);
  db.prepare("INSERT INTO dist_frames (location_id, frame_name, total_pairs, team_id) VALUES (?, 'A-FDF', 50, ?)").run(aIdc, aId);
  db.prepare("INSERT INTO contracts (contract_name, team_id) VALUES ('A-계약', ?)").run(aId);
  db.prepare("INSERT INTO contracts (contract_name, team_id) VALUES ('B-계약', ?)").run(bId);
  void rSharedEmpty; void rADedicated;
});

after(() => {
  try { db.close(); } catch { /* noop */ }
  rmSync(dir, { recursive: true, force: true });
});

function rackNamesFor(actor: Actor): string[] {
  const s = rackScopeWhere(actor, "r.team_id", "r.id");
  return (db.prepare(`SELECT r.rack_name FROM racks r WHERE ${s.sql} ORDER BY r.rack_name`).all(...s.params) as any[])
    .map((x) => x.rack_name);
}

test("마이그레이션: 인프라 테이블에 team_id 컬럼이 추가된다", () => {
  for (const t of ["locations", "racks", "dist_frames", "ip_subnets", "contracts"]) {
    const cols = new Set((db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name));
    assert.ok(cols.has("team_id"), `${t}.team_id 없음`);
  }
});

test("버그 회귀: B팀은 자산 없는 공유 랙(KS-EMPTY)을 보지 못한다", () => {
  const names = rackNamesFor(teamB);
  assert.ok(!names.includes("KS-EMPTY"), "공유 빈 랙이 팀에게 노출됨(버그 재현)");
});

test("하이브리드: B팀은 자기 자산이 있는 공유 랙(KS-B)만 본다 (A전용랙 제외)", () => {
  const names = rackNamesFor(teamB);
  assert.deepEqual(names, ["KS-B"]);
});

test("하이브리드: A팀은 전용 랙(A-RACK)을 자산이 없어도 본다", () => {
  const names = rackNamesFor(teamA);
  assert.deepEqual(names, ["A-RACK"]);
});

test("총괄(admin): 모든 랙을 본다", () => {
  const names = rackNamesFor(admin);
  assert.deepEqual(names, ["A-RACK", "KS-B", "KS-EMPTY"]);
});

test("위치 하이브리드: A팀은 자기 위치, B팀은 자산 있는 공용센터만", () => {
  const locNames = (actor: Actor) => {
    const s = locationScopeWhere(actor, "l.team_id", "l.id");
    return (db.prepare(`SELECT l.location_name FROM locations l WHERE ${s.sql} ORDER BY l.location_name`).all(...s.params) as any[]).map((x) => x.location_name);
  };
  assert.deepEqual(locNames(teamA), ["A외부IDC"]);
  assert.deepEqual(locNames(teamB), ["공용센터"]);
  assert.deepEqual(locNames(admin), ["A외부IDC", "공용센터"]);
});

test("소유 전용: subnet/frame/contract는 자기 팀 것만 (총괄은 전체)", () => {
  const names = (sqlTable: string, col: string, nameCol: string, actor: Actor) => {
    const s = scopeWhere(actor, col);
    return (db.prepare(`SELECT ${nameCol} AS n FROM ${sqlTable} WHERE ${s.sql} ORDER BY ${nameCol}`).all(...s.params) as any[]).map((x) => x.n);
  };
  assert.deepEqual(names("ip_subnets", "team_id", "subnet_name", teamA), ["A-net"]);
  assert.deepEqual(names("ip_subnets", "team_id", "subnet_name", teamB), ["B-net"]);
  assert.deepEqual(names("contracts", "team_id", "contract_name", teamA), ["A-계약"]);
  assert.deepEqual(names("contracts", "team_id", "contract_name", admin), ["A-계약", "B-계약"]);
  assert.deepEqual(names("dist_frames", "team_id", "frame_name", teamB), []); // B팀 배선 없음
  assert.deepEqual(names("dist_frames", "team_id", "frame_name", teamA), ["A-FDF"]);
});

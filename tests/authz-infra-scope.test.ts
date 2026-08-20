// tests/authz-infra-scope.test.ts — 부서 독립 운영(ADR-011) 인프라 소유 스코프 단위테스트
// 대상: rackScopeWhere(하이브리드), locationScopeWhere(하이브리드), assertCanPlaceInRack(배치 규칙),
//       scopeWhere(소유 전용: subnet/frame/contract).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rackScopeWhere,
  locationScopeWhere,
  assertCanPlaceInRack,
  scopeWhere,
  AuthzError,
  type Actor,
} from "../src/lib/authz.ts";

const admin: Actor = { userId: 1, username: "admin", role: "admin", teamId: null };
const viewer: Actor = { userId: 2, username: "viewer", role: "viewer", teamId: null };
const teamA: Actor = { userId: 3, username: "a", role: "team", teamId: 10 };
const teamNoTeam: Actor = { userId: 4, username: "n", role: "team", teamId: null };

// ── rackScopeWhere (하이브리드: 소유 OR 내 팀 자산 존재) ──
test("rackScopeWhere: admin/viewer는 전체(1=1)", () => {
  assert.equal(rackScopeWhere(admin).sql, "(1 = 1)");
  assert.equal(rackScopeWhere(viewer).sql, "(1 = 1)");
});

test("rackScopeWhere: 미인증/팀미배정 team은 deny-all(1=0)", () => {
  assert.equal(rackScopeWhere(null).sql, "(1 = 0)");
  assert.equal(rackScopeWhere(teamNoTeam).sql, "(1 = 0)");
});

test("rackScopeWhere: team은 소유(team_id) OR 그 랙에 내 팀 자산 EXISTS", () => {
  const s = rackScopeWhere(teamA, "r.team_id", "r.id");
  assert.match(s.sql, /r\.team_id = \?/);
  assert.match(s.sql, /EXISTS \(SELECT 1 FROM assets _a WHERE _a\.rack_id = r\.id AND _a\.team_id = \?\)/);
  assert.deepEqual(s.params, [10, 10]); // 소유팀 + 자산팀 두 바인딩
});

test("rackScopeWhere: 안전하지 않은 컬럼명은 500 AuthzError", () => {
  assert.throws(() => rackScopeWhere(teamA, "r.team_id; DROP", "r.id"), AuthzError);
  assert.throws(() => rackScopeWhere(teamA, "r.team_id", "r.id--"), AuthzError);
});

// ── locationScopeWhere (하이브리드: 소유 OR 보이는 랙/대역/배선 존재) ──
test("locationScopeWhere: admin/viewer는 전체", () => {
  assert.equal(locationScopeWhere(admin).sql, "(1 = 1)");
  assert.equal(locationScopeWhere(viewer).sql, "(1 = 1)");
});

test("locationScopeWhere: team은 소유 + 랙(하이브리드)/대역/배선 EXISTS, 5개 바인딩", () => {
  const s = locationScopeWhere(teamA, "l.team_id", "l.id");
  assert.match(s.sql, /l\.team_id = \?/);
  assert.match(s.sql, /FROM racks _r WHERE _r\.location_id = l\.id/);
  assert.match(s.sql, /FROM ip_subnets _s WHERE _s\.location_id = l\.id AND _s\.team_id = \?/);
  assert.match(s.sql, /FROM dist_frames _f WHERE _f\.location_id = l\.id AND _f\.team_id = \?/);
  assert.deepEqual(s.params, [10, 10, 10, 10, 10]);
});

test("locationScopeWhere: 팀미배정/미인증은 deny-all", () => {
  assert.equal(locationScopeWhere(teamNoTeam).sql, "(1 = 0)");
  assert.equal(locationScopeWhere(null).sql, "(1 = 0)");
});

// ── scopeWhere (소유 전용: subnet/frame/contract) ──
test("scopeWhere: team은 자기 team_id만, admin/viewer 전체", () => {
  assert.deepEqual(scopeWhere(teamA, "s.team_id"), { sql: "(s.team_id = ?)", params: [10] });
  assert.equal(scopeWhere(admin, "s.team_id").sql, "(1 = 1)");
  assert.equal(scopeWhere(viewer, "c.team_id").sql, "(1 = 1)");
  assert.equal(scopeWhere(teamNoTeam, "df.team_id").sql, "(1 = 0)");
});

// ── assertCanPlaceInRack (배치 규칙) ──
test("assertCanPlaceInRack: admin은 어떤 랙에도 배치 가능", () => {
  assert.doesNotThrow(() => assertCanPlaceInRack(admin, null));
  assert.doesNotThrow(() => assertCanPlaceInRack(admin, 99));
});

test("assertCanPlaceInRack: team은 자기 소유 랙 배치 가능", () => {
  assert.doesNotThrow(() => assertCanPlaceInRack(teamA, 10));
});

test("assertCanPlaceInRack: team은 공유(NULL) 랙 배치 가능", () => {
  assert.doesNotThrow(() => assertCanPlaceInRack(teamA, null));
});

test("assertCanPlaceInRack: team은 타팀 전용 랙에 배치 불가(403)", () => {
  assert.throws(() => assertCanPlaceInRack(teamA, 20), (e: unknown) => e instanceof AuthzError && (e as AuthzError).status === 403);
});

test("assertCanPlaceInRack: viewer는 배치 불가", () => {
  assert.throws(() => assertCanPlaceInRack(viewer, null), AuthzError);
});

test("assertCanPlaceInRack: 미인증은 401", () => {
  assert.throws(() => assertCanPlaceInRack(null, null), (e: unknown) => e instanceof AuthzError && (e as AuthzError).status === 401);
});

test("assertCanPlaceInRack: 팀미배정 team은 배치 불가", () => {
  assert.throws(() => assertCanPlaceInRack(teamNoTeam, null), AuthzError);
});

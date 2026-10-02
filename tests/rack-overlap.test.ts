// tests/rack-overlap.test.ts — 랙 슬롯 겹침 판정(반폭 장비 포함) 단위테스트
// 규칙: 구간 겹침(a.start <= b.end && b.start <= a.end, end = start+size-1)
//       AND (a.side == null || b.side == null || a.side === b.side)
//       null/undefined side = 전폭(모든 side와 충돌)
import { test } from "node:test";
import assert from "node:assert/strict";
import { overlaps, findRackConflicts, type RackSpan, type RackPlacement } from "../src/lib/rack-overlap.ts";

const span = (start: number, size: number, side?: "L" | "R" | null): RackSpan => ({ start, size, side });

test("구간 겹침: 부분 겹침", () => {
  assert.equal(overlaps(span(1, 3), span(2, 3)), true); // 1~3 vs 2~4
  assert.equal(overlaps(span(2, 3), span(1, 3)), true); // 대칭
});

test("구간 겹침: 완전 포함", () => {
  assert.equal(overlaps(span(1, 10), span(3, 2)), true); // 1~10 안에 3~4
  assert.equal(overlaps(span(3, 2), span(1, 10)), true);
});

test("구간 비겹침: 떨어진 구간", () => {
  assert.equal(overlaps(span(1, 2), span(4, 2)), false); // 1~2 vs 4~5
  assert.equal(overlaps(span(4, 2), span(1, 2)), false);
});

test("경계값: 한쪽 end == 다른쪽 start (겹침)", () => {
  assert.equal(overlaps(span(1, 3), span(3, 2)), true); // 1~3 vs 3~4, 3U 공유
  assert.equal(overlaps(span(3, 2), span(1, 3)), true);
});

test("경계값: 인접 구간(end+1 == start)은 비겹침", () => {
  assert.equal(overlaps(span(1, 3), span(4, 2)), false); // 1~3 vs 4~5
});

test("경계값: 1U 장비 동일 시작(end == start)", () => {
  assert.equal(overlaps(span(5, 1), span(5, 1)), true); // 5~5 vs 5~5
  assert.equal(overlaps(span(5, 1), span(6, 1)), false); // 5~5 vs 6~6
});

test("전폭 vs 반폭: side 없음(undefined)은 모든 side와 충돌", () => {
  assert.equal(overlaps(span(1, 2), span(1, 2, "L")), true);
  assert.equal(overlaps(span(1, 2), span(1, 2, "R")), true);
  assert.equal(overlaps(span(1, 2, "L"), span(1, 2)), true); // 대칭
});

test("전폭 vs 반폭: side null도 전폭으로 취급", () => {
  assert.equal(overlaps(span(1, 2, null), span(1, 2, "L")), true);
  assert.equal(overlaps(span(1, 2, "R"), span(1, 2, null)), true);
  assert.equal(overlaps(span(1, 2, null), span(1, 2, null)), true);
});

test("반폭: L-L 동일 side는 충돌", () => {
  assert.equal(overlaps(span(1, 2, "L"), span(2, 2, "L")), true);
  assert.equal(overlaps(span(1, 2, "R"), span(2, 2, "R")), true);
});

test("반폭: L-R 다른 side는 구간이 겹쳐도 비충돌", () => {
  assert.equal(overlaps(span(1, 2, "L"), span(1, 2, "R")), false);
  assert.equal(overlaps(span(1, 2, "R"), span(1, 2, "L")), false);
});

test("반폭: side가 달라도 구간이 안 겹치면 당연히 비충돌", () => {
  assert.equal(overlaps(span(1, 2, "L"), span(4, 2, "R")), false);
});

test("반폭: 같은 side라도 구간이 안 겹치면 비충돌", () => {
  assert.equal(overlaps(span(1, 2, "L"), span(4, 2, "L")), false);
});

// ── findRackConflicts (대시보드 실장 충돌 — 예전 자기조인 SQL 과 같은 결과, 1만 건 시험 DB 300회 퍼즈로 대조함) ──
const P = (o: Partial<RackPlacement> & { id: number; start: number }): RackPlacement =>
  ({ rackId: 1, rackName: "A", name: `as${o.id}`, size: 1, side: null, inScope: true, ...o });

test("findRackConflicts: 겹친 쌍만, id 작은 쪽이 a, 겹침 구간 계산", () => {
  const got = findRackConflicts([P({ id: 2, start: 3, size: 3 }), P({ id: 1, start: 5, size: 2 }), P({ id: 3, start: 10 })]);
  assert.deepEqual(got, [{ rackName: "A", ovStart: 5, ovEnd: 5, aName: "as1", bName: "as2" }]);
});

test("findRackConflicts: 반폭 L/R 는 공존, 같은 방향·전폭은 충돌 (overlaps 규칙 그대로)", () => {
  const rows = [P({ id: 1, start: 1, side: "L" }), P({ id: 2, start: 1, side: "R" }), P({ id: 3, start: 2, side: "L" }), P({ id: 4, start: 2, side: "L" }), P({ id: 5, start: 4, size: 2 }), P({ id: 6, start: 5, side: "R" })];
  assert.deepEqual(findRackConflicts(rows).map((c) => `${c.aName}-${c.bName}`), ["as3-as4", "as5-as6"]);
});

test("findRackConflicts: 쌍 중 하나라도 범위면 노출, 둘 다 범위 밖이면 숨김", () => {
  const rows = [P({ id: 1, start: 1, inScope: false }), P({ id: 2, start: 1, inScope: false }), P({ id: 3, start: 7, inScope: false }), P({ id: 4, start: 7, inScope: true })];
  assert.deepEqual(findRackConflicts(rows).map((c) => `${c.aName}-${c.bName}`), ["as3-as4"]);
});

test("findRackConflicts: 랙 이름 → 겹침 시작U 순, limit 에서 자름", () => {
  const rows = [
    P({ id: 1, rackId: 2, rackName: "B", start: 1 }), P({ id: 2, rackId: 2, rackName: "B", start: 1 }),
    P({ id: 3, rackId: 1, rackName: "A", start: 9 }), P({ id: 4, rackId: 1, rackName: "A", start: 9 }),
    P({ id: 5, rackId: 1, rackName: "A", start: 2 }), P({ id: 6, rackId: 1, rackName: "A", start: 2 }),
  ];
  assert.deepEqual(findRackConflicts(rows).map((c) => `${c.rackName}${c.ovStart}`), ["A2", "A9", "B1"]);
  assert.equal(findRackConflicts(rows, 2).length, 2);
});

test("findRackConflicts: 한 랙에 많이 몰려도 겹치지 않는 쌍은 비교하지 않는다(스윕) — 2만 건 1초 안", () => {
  const rows = Array.from({ length: 20000 }, (_, i) => P({ id: i + 1, start: i + 1 })); // 서로 안 겹침
  const t = performance.now();
  assert.deepEqual(findRackConflicts(rows), []);
  assert.ok(performance.now() - t < 1000, `${Math.round(performance.now() - t)}ms`);
});

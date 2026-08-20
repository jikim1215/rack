// tests/rack-overlap.test.ts — 랙 슬롯 겹침 판정(반폭 장비 포함) 단위테스트
// 규칙: 구간 겹침(a.start <= b.end && b.start <= a.end, end = start+size-1)
//       AND (a.side == null || b.side == null || a.side === b.side)
//       null/undefined side = 전폭(모든 side와 충돌)
import { test } from "node:test";
import assert from "node:assert/strict";
import { overlaps, type RackSpan } from "../src/lib/rack-overlap.ts";

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

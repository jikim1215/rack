// tests/kst.test.ts — KST 날짜: toISOString().slice(0,10)(UTC) 은 KST 00:00~08:59 에 하루 전이 나온다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kstDate } from "../src/lib/kst.ts";

test("KST 자정 직후(UTC 전날 15시대)에도 KST 당일", () => {
  const t = new Date("2026-11-22T15:30:00Z"); // = 2026-11-23 00:30 KST
  assert.equal(t.toISOString().slice(0, 10), "2026-11-22", "UTC 기준은 전날 — 버그 재현");
  assert.equal(kstDate(t), "2026-11-23");
});

test("경계: KST 23:59 는 당일, 00:00 은 다음날", () => {
  assert.equal(kstDate(new Date("2026-11-23T14:59:59Z")), "2026-11-23");
  assert.equal(kstDate(new Date("2026-11-23T15:00:00Z")), "2026-11-24");
});

test("offsetDays 로 N일 뒤 (월·연 경계 포함)", () => {
  assert.equal(kstDate(new Date("2026-12-31T16:00:00Z"), 0), "2027-01-01");
  assert.equal(kstDate(new Date("2026-11-23T00:00:00Z"), 90), "2027-02-21");
  assert.equal(kstDate(new Date("2026-03-01T00:00:00Z"), -1), "2026-02-28");
});

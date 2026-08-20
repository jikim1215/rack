// tests/user-admin.test.ts — 사용자 계정 관리 순수 로직 단위테스트
// 실행: node --experimental-strip-types --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEmail, normalizeEmail, wouldRemoveLastAdmin } from "../src/lib/user-admin.ts";

test("validateEmail: 정상 이메일은 null", () => {
  assert.equal(validateEmail("admin@example.go.kr"), null);
  assert.equal(validateEmail("user.01@example.com"), null);
  assert.equal(validateEmail("  padded@example.go.kr  "), null); // 트림 후 형식 통과
});

test("validateEmail: 형식 위반 거부", () => {
  assert.notEqual(validateEmail("admin"), null); // @ 없음
  assert.notEqual(validateEmail("admin@kisa"), null); // TLD 없음
  assert.notEqual(validateEmail("a@@b.com"), null);
  assert.notEqual(validateEmail("@example.go.kr"), null);
});

test("validateEmail: 빈값/공백/타입 거부", () => {
  assert.notEqual(validateEmail(""), null);
  assert.notEqual(validateEmail("   "), null);
  assert.notEqual(validateEmail("ad min@example.go.kr"), null); // 내부 공백
  assert.notEqual(validateEmail(undefined), null);
  assert.notEqual(validateEmail(123 as unknown), null);
});

test("validateEmail: 254자 초과 거부", () => {
  const long = "a".repeat(250) + "@b.com";
  assert.notEqual(validateEmail(long), null);
});

test("normalizeEmail: 트림 + 소문자", () => {
  assert.equal(normalizeEmail("  Admin@example.go.kr "), "admin@example.go.kr");
});

test("wouldRemoveLastAdmin: 유일한 활성 admin을 강등/비활성/삭제하면 차단", () => {
  assert.equal(wouldRemoveLastAdmin([1], 1, false), true);
});

test("wouldRemoveLastAdmin: 유일한 활성 admin이라도 admin으로 남으면 허용", () => {
  assert.equal(wouldRemoveLastAdmin([1], 1, true), false);
});

test("wouldRemoveLastAdmin: 다른 활성 admin이 있으면 대상 제거 허용", () => {
  assert.equal(wouldRemoveLastAdmin([1, 2], 1, false), false);
  assert.equal(wouldRemoveLastAdmin([1, 2], 2, false), false);
});

test("wouldRemoveLastAdmin: admin이 아닌 대상 제거는 admin 풀에 무영향", () => {
  assert.equal(wouldRemoveLastAdmin([1], 9, false), false);
});

test("wouldRemoveLastAdmin: 마지막 팀원을 admin으로 승격하면 허용", () => {
  assert.equal(wouldRemoveLastAdmin([], 5, true), false);
});

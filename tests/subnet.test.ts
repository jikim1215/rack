// tests/subnet.test.ts — 서브넷 마스크 검증·범위 계산 (API 입력 검증과 IPAM 격자가 공유하는 정본)
import { test } from "node:test";
import assert from "node:assert/strict";
import { ipv4ToNum, maskToPrefix, prefixToMaskNum, subnetRange, subnetMaskError } from "../src/lib/subnet.ts";

test("prefixToMaskNum: /0 은 0 (JS 시프트 32 mod 32 함정), /32 는 전부 1", () => {
  assert.equal(prefixToMaskNum(0), 0);
  assert.equal(prefixToMaskNum(32), 0xFFFFFFFF);
  assert.equal(prefixToMaskNum(24), 0xFFFFFF00);
  assert.equal(prefixToMaskNum(1), 0x80000000);
});

test("maskToPrefix: 연속 마스크만 인정", () => {
  assert.equal(maskToPrefix("255.255.255.0"), 24);
  assert.equal(maskToPrefix("255.255.255.255"), 32);
  assert.equal(maskToPrefix("0.0.0.0"), 0);
  assert.equal(maskToPrefix("255.255.240.0"), 20);
  assert.equal(maskToPrefix(" 255.255.255.128 "), 25);
  assert.equal(maskToPrefix("255.0.255.0"), null, "비연속");
  assert.equal(maskToPrefix("255.255.255.1"), null, "비연속(꼬리 1)");
  assert.equal(maskToPrefix("255.255.256.0"), null, "옥텟 범위 초과");
  assert.equal(maskToPrefix("/24"), null);
  assert.equal(maskToPrefix(""), null);
});

test("subnetRange: 첫 옥텟 ≥128 대역도 부호없는 값", () => {
  const r = subnetRange("192.168.10.77", "255.255.255.0");
  assert.deepEqual(r, { prefix: 24, start: ipv4ToNum("192.168.10.0"), end: ipv4ToNum("192.168.10.255") });
  assert.ok(r!.start > 0);
  const host = subnetRange("10.0.0.5", "255.255.255.255");
  assert.deepEqual(host, { prefix: 32, start: ipv4ToNum("10.0.0.5"), end: ipv4ToNum("10.0.0.5") });
  const all = subnetRange("10.0.0.0", "0.0.0.0");
  assert.deepEqual(all, { prefix: 0, start: 0, end: 0xFFFFFFFF });
  assert.equal(subnetRange("10.0.0.0", "255.0.255.0"), null);
});

test("subnetMaskError: /16~/32 연속 마스크만 통과", () => {
  assert.equal(subnetMaskError("255.255.255.0"), null);
  assert.equal(subnetMaskError("255.255.0.0"), null);
  assert.equal(subnetMaskError("255.255.255.255"), null);
  assert.match(subnetMaskError("255.254.0.0") ?? "", /\/16~\/32/);
  assert.match(subnetMaskError("0.0.0.0") ?? "", /\/16~\/32/);
  assert.match(subnetMaskError("255.0.255.0") ?? "", /올바르지 않습니다/);
  assert.match(subnetMaskError("abc") ?? "", /올바르지 않습니다/);
});

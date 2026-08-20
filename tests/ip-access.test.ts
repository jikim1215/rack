import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ipv4ToInt,
  isValidRule,
  parseRules,
  matchRule,
  isIpAllowed,
} from "../src/lib/ip-access.ts";

test("ipv4ToInt: 정상/경계/오류", () => {
  assert.equal(ipv4ToInt("0.0.0.0"), 0);
  assert.equal(ipv4ToInt("255.255.255.255"), 4294967295);
  assert.equal(ipv4ToInt("192.168.1.1"), (192 << 24 | 168 << 16 | 1 << 8 | 1) >>> 0);
  assert.equal(ipv4ToInt("256.0.0.1"), null); // 옥텟 초과
  assert.equal(ipv4ToInt("1.2.3"), null);     // 형식 오류
  assert.equal(ipv4ToInt("abc"), null);
  assert.equal(ipv4ToInt(""), null);
});

test("isValidRule: 단일 IP / CIDR / 오류", () => {
  assert.equal(isValidRule("10.20.30.40"), true);      // 단일
  assert.equal(isValidRule("10.20.0.0/16"), true);     // CIDR
  assert.equal(isValidRule("0.0.0.0/0"), true);        // 전체
  assert.equal(isValidRule("10.20.0.0/33"), false);    // prefix 초과
  assert.equal(isValidRule("10.20.0.0/-1"), false);
  assert.equal(isValidRule("999.1.1.1"), false);
  assert.equal(isValidRule(""), false);
});

test("parseRules: 구분자/중복/무효 제거", () => {
  assert.deepEqual(parseRules("10.0.0.1, 10.0.0.2"), ["10.0.0.1", "10.0.0.2"]);
  assert.deepEqual(parseRules("10.0.0.1\n10.0.0.1"), ["10.0.0.1"]); // 중복 제거
  assert.deepEqual(parseRules("10.0.0.1; bad; 10.0.0.2/24"), ["10.0.0.1", "10.0.0.2/24"]); // 무효 제거
  assert.deepEqual(parseRules(""), []);
  assert.deepEqual(parseRules(null), []);
});

test("matchRule: 단일 IP", () => {
  assert.equal(matchRule("10.20.30.40", "10.20.30.40"), true);
  assert.equal(matchRule("10.20.30.41", "10.20.30.40"), false);
});

test("matchRule: CIDR 대역", () => {
  assert.equal(matchRule("10.20.30.40", "10.20.0.0/16"), true);   // 대역 내
  assert.equal(matchRule("10.20.255.254", "10.20.0.0/16"), true);
  assert.equal(matchRule("10.21.0.1", "10.20.0.0/16"), false);    // 대역 밖
  assert.equal(matchRule("10.20.30.40", "10.20.30.0/24"), true);
  assert.equal(matchRule("10.20.31.1", "10.20.30.0/24"), false);
  assert.equal(matchRule("1.2.3.4", "0.0.0.0/0"), true);          // 전체 허용
});

test("isIpAllowed: 제한 없는 사용자(빈 규칙) → 항상 허용", () => {
  assert.deepEqual(isIpAllowed("10.20.30.40", ""), { allowed: true, restricted: false });
  assert.deepEqual(isIpAllowed("direct", null), { allowed: true, restricted: false });
});

test("isIpAllowed: 화이트리스트 매칭", () => {
  assert.deepEqual(isIpAllowed("10.20.30.40", "10.20.0.0/16"), { allowed: true, restricted: true });
  assert.deepEqual(isIpAllowed("10.21.0.1", "10.20.0.0/16"), { allowed: false, restricted: true });
  assert.deepEqual(isIpAllowed("10.0.0.5", "10.0.0.1, 10.0.0.5"), { allowed: true, restricted: true });
});

test("isIpAllowed: 제한 있는데 IP 미상(direct) → 거부", () => {
  // TRUST_PROXY 미설정 등으로 IP 를 못 얻으면 제한 사용자는 접근 불가(안전 기본값)
  assert.deepEqual(isIpAllowed("direct", "10.20.0.0/16"), { allowed: false, restricted: true });
  assert.deepEqual(isIpAllowed("", "10.20.0.0/16"), { allowed: false, restricted: true });
});

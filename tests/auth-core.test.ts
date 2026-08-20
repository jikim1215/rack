// tests/auth-core.test.ts — 인증 코어 순수 모듈 단위테스트
// 실행: node --experimental-strip-types --test tests/
// AUTH_SECRET을 임포트 전에 설정해야 하므로 동적 import 사용.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";

const TEST_SECRET = "unit-test-secret-9f8a7b6c5d4e3f2a1b0c";
process.env.AUTH_SECRET = TEST_SECRET;

const {
  createSessionToken,
  verifySessionToken,
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  hashPlaintextPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} = await import("../src/lib/auth-core.ts");

const basePayload = {
  userId: 7,
  username: "tester",
  displayName: "테스터",
  role: "team" as const,
  teamId: 3,
  tv: 2,
};

test("세션 토큰: 생성 → 검증 왕복", () => {
  const token = createSessionToken(basePayload);
  const payload = verifySessionToken(token);
  assert.ok(payload, "정상 토큰은 검증을 통과해야 한다");
  assert.equal(payload.userId, 7);
  assert.equal(payload.username, "tester");
  assert.equal(payload.displayName, "테스터");
  assert.equal(payload.role, "team");
  assert.equal(payload.teamId, 3);
  assert.equal(payload.tv, 2);
  assert.ok(payload.exp > Date.now(), "만료 시각은 미래여야 한다");
});

test("세션 토큰: 서명 변조 거부", () => {
  const token = createSessionToken(basePayload);
  const [json, sig] = token.split(".");
  // 서명 중간 문자 뒤집기 — 마지막 문자는 base64url 패딩 비트(디코드 시 무시)라 변조해도
  // 동일 바이트로 디코드될 수 있어 변조 검증에 부적합하다(서명 등가 클래스).
  const mid = Math.floor(sig.length / 2);
  const flipped = sig.slice(0, mid) + (sig[mid] === "A" ? "B" : "A") + sig.slice(mid + 1);
  assert.equal(verifySessionToken(`${json}.${flipped}`), null);
});

test("세션 토큰: 페이로드 변조 거부(권한 상승 시도)", () => {
  const token = createSessionToken(basePayload);
  const [json, sig] = token.split(".");
  const data = JSON.parse(Buffer.from(json, "base64url").toString());
  data.role = "admin";
  const forged = Buffer.from(JSON.stringify(data)).toString("base64url");
  assert.equal(verifySessionToken(`${forged}.${sig}`), null);
});

test("세션 토큰: 형식 불량 거부", () => {
  assert.equal(verifySessionToken(""), null);
  assert.equal(verifySessionToken("noseparator"), null);
  assert.equal(verifySessionToken("a.b.c"), null);
  assert.equal(verifySessionToken("배드토큰.시그"), null);
});

test("세션 토큰: 만료 거부", () => {
  // 서명 규약(HMAC-SHA512 over base64url(json))을 그대로 재현해 과거 exp 토큰을 위조 아닌 정식 서명으로 생성
  const expired = { ...basePayload, exp: Date.now() - 1000 };
  const json = Buffer.from(JSON.stringify(expired)).toString("base64url");
  const sig = createHmac("sha512", TEST_SECRET).update(json).digest("base64url");
  assert.equal(verifySessionToken(`${json}.${sig}`), null);
});

test("비밀번호 해시: 왕복 검증", () => {
  // 실제 흐름에서는 sha512 프리해시 문자열이 들어오지만, 해시/검증 규약 자체는 입력 문자열에 불변
  const stored = hashPassword("sha512-prehashed-value-예시");
  assert.ok(stored.includes(":"), "저장 형식은 salt:hash");
  assert.equal(verifyPassword("sha512-prehashed-value-예시", stored), true);
});

test("비밀번호 해시: 오답 거부", () => {
  const stored = hashPassword("correct-value");
  assert.equal(verifyPassword("wrong-value", stored), false);
});

test("비밀번호 해시: 저장 형식 불량 거부", () => {
  assert.equal(verifyPassword("anything", "no-colon-here"), false);
  assert.equal(verifyPassword("anything", ""), false);
});

test("비밀번호 해시: 동일 입력도 솔트가 달라 저장물이 다르다", () => {
  const a = hashPassword("same-input");
  const b = hashPassword("same-input");
  assert.notEqual(a, b);
  assert.equal(verifyPassword("same-input", a), true);
  assert.equal(verifyPassword("same-input", b), true);
});

test("비밀번호 정책: 경계값", () => {
  // 최소 길이 경계 (8자)
  assert.notEqual(validatePasswordPolicy("a1b2c3!"), null, "7자는 거부");
  assert.equal(validatePasswordPolicy("a1b2c3!d"), null, "8자+2종 조합은 허용");
  // 최대 길이 경계 (256자)
  const max = "a1".repeat(128); // 정확히 256자, 영문+숫자 2종
  assert.equal(max.length, PASSWORD_MAX_LENGTH);
  assert.equal(validatePasswordPolicy(max), null, "256자는 허용");
  assert.notEqual(validatePasswordPolicy(max + "x"), null, "257자는 거부");
  // 문자 종류 조합 (2종 미만 거부)
  assert.notEqual(validatePasswordPolicy("abcdefgh"), null, "영문 1종만은 거부");
  assert.notEqual(validatePasswordPolicy("12345678"), null, "숫자 1종만은 거부");
  assert.equal(validatePasswordPolicy("abcd1234"), null, "영문+숫자 허용");
  assert.equal(validatePasswordPolicy("abcd!@#$"), null, "영문+특수문자 허용");
  // 타입 불량
  assert.notEqual(validatePasswordPolicy(null), null);
  assert.notEqual(validatePasswordPolicy(12345678), null);
  assert.equal(PASSWORD_MIN_LENGTH, 8);
});

test("비밀번호 초기화(이메일=초기비번): 저장물 왕복 검증", () => {
  // 관리자 초기화는 비밀번호를 사용자 이메일 주소로 설정한다(공존시스템 규약).
  //   저장물 = hashPlaintextPassword(email) → 로그인은 sha512(email) 프리해시로 검증.
  for (const email of ["admin@example.go.kr", "hong.gildong@example.go.kr", "a@b.co"]) {
    const stored = hashPlaintextPassword(email);
    const clientPrehash = createHash("sha512").update(email).digest("hex");
    assert.equal(verifyPassword(clientPrehash, stored), true, `이메일 초기비번 검증 실패: ${email}`);
    // 오답 거부
    assert.equal(verifyPassword(createHash("sha512").update(email + "x").digest("hex"), stored), false);
  }
});

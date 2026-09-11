// tests/totp.test.ts — TOTP 2단계 인증 코어 (RFC 6238/4226 벡터 + replay·백업코드 정책)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Encode, base32Decode, generateSecret, formatSecretForDisplay,
  hotp, totp, verifyTotp, counterAt, otpauthUri,
  generateBackupCodes, findBackupCode, normalizeBackupCode, hashBackupCode,
  TOTP_STEP_SEC,
} from "../src/lib/totp.ts";

// ── base32 ──
test("base32: 왕복 인코딩/디코딩", () => {
  for (const s of ["f", "fo", "foo", "foob", "fooba", "foobar"]) {
    const buf = Buffer.from(s);
    assert.deepEqual(base32Decode(base32Encode(buf)), buf, `왕복 실패: ${s}`);
  }
  // 빈 입력은 의도적 거부 — 빈 시크릿으로 HMAC 을 개산하면 안 된다(모든 코드가 예측 가능해짐).
  assert.equal(base32Encode(Buffer.alloc(0)), "");
  assert.throws(() => base32Decode(""), /빈 시크릿/);
});

test("base32: RFC 4648 벡터", () => {
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.equal(base32Decode("MZXW6YTBOI").toString(), "foobar");
});

test("base32: 공백·하이픈·소문자·패딩 허용, 잘못된 문자는 오류", () => {
  assert.equal(base32Decode("mzxw 6ytb-oi=").toString(), "foobar");
  assert.throws(() => base32Decode("MZXW6YTB01")); // 0,1 은 base32 알파벳 밖
  assert.throws(() => base32Decode(""));
});

// ── HOTP/TOTP 표준 벡터 ──
// RFC 4226 Appendix D — 시크릿 "12345678901234567890"
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("HOTP: RFC 4226 표준 벡터 (counter 0~9)", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  expected.forEach((code, c) => assert.equal(hotp(RFC_SECRET, c), code, `counter ${c}`));
});

test("TOTP: RFC 6238 표준 벡터 (SHA-1)", () => {
  // RFC 6238 Appendix B 의 SHA-1 행 — 8자리 기준이므로 하위 6자리로 비교
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ];
  for (const [sec, eight] of vectors) {
    assert.equal(totp(RFC_SECRET, sec * 1000), eight.slice(-6), `t=${sec}`);
  }
});

test("counterAt: 30초 스텝", () => {
  assert.equal(counterAt(0), 0);
  assert.equal(counterAt(29_999), 0);
  assert.equal(counterAt(30_000), 1);
  assert.equal(counterAt(59_999), 1);
});

// ── 검증 정책 ──
test("verifyTotp: 현재 코드 통과, 형식 오류/불일치 거부", () => {
  const secret = generateSecret();
  const now = Date.now();
  assert.equal(verifyTotp(secret, totp(secret, now), { nowMs: now }).ok, true);
  assert.equal(verifyTotp(secret, "12345", { nowMs: now }).reason, "format", "5자리는 형식 오류");
  assert.equal(verifyTotp(secret, "abcdef", { nowMs: now }).reason, "format");
  assert.equal(verifyTotp(secret, "000000", { nowMs: now }).reason ?? "mismatch", "mismatch");
});

test("verifyTotp: ±1 스텝(시계 오차) 허용, ±2 는 거부", () => {
  const secret = generateSecret();
  const now = Date.now();
  const step = TOTP_STEP_SEC * 1000;
  assert.equal(verifyTotp(secret, totp(secret, now - step), { nowMs: now }).ok, true, "직전 코드 허용");
  assert.equal(verifyTotp(secret, totp(secret, now + step), { nowMs: now }).ok, true, "다음 코드 허용");
  assert.equal(verifyTotp(secret, totp(secret, now - 2 * step), { nowMs: now }).ok, false, "2스텝 전은 거부");
  assert.equal(verifyTotp(secret, totp(secret, now + 2 * step), { nowMs: now }).ok, false, "2스텝 후는 거부");
});

test("verifyTotp: 재사용(replay) 차단 — 같은 counter 는 한 번만", () => {
  const secret = generateSecret();
  const now = Date.now();
  const first = verifyTotp(secret, totp(secret, now), { nowMs: now });
  assert.ok(first.ok && typeof first.counter === "number");
  // 같은 코드를 lastCounter 기록 후 다시 제출 → replay
  const again = verifyTotp(secret, totp(secret, now), { nowMs: now, lastCounter: first.counter });
  assert.equal(again.ok, false);
  assert.equal(again.reason, "replay");
  // 다음 스텝 코드는 통과
  const next = verifyTotp(secret, totp(secret, now + TOTP_STEP_SEC * 1000), { nowMs: now + TOTP_STEP_SEC * 1000, lastCounter: first.counter });
  assert.equal(next.ok, true);
});

test("verifyTotp: 직전 스텝 코드도 lastCounter 이하면 거부 (윈도우 재사용 방지)", () => {
  const secret = generateSecret();
  const now = Date.now();
  const cur = counterAt(now);
  // 현재 코드로 성공한 뒤, 직전 스텝 코드를 제출하면 counter 가 더 작으므로 replay
  const prev = verifyTotp(secret, totp(secret, now - TOTP_STEP_SEC * 1000), { nowMs: now, lastCounter: cur });
  assert.equal(prev.ok, false);
  assert.equal(prev.reason, "replay");
});

test("generateSecret: 32자 base32, 매번 다름", () => {
  const a = generateSecret(), b = generateSecret();
  assert.match(a, /^[A-Z2-7]{32}$/);
  assert.notEqual(a, b);
  assert.equal(formatSecretForDisplay(a).replace(/ /g, ""), a);
  assert.equal(formatSecretForDisplay(a).split(" ")[0].length, 4);
});

test("otpauthUri: 인증 앱이 읽는 형식", () => {
  const secret = generateSecret();
  const uri = otpauthUri(secret, "admin@example.go.kr");
  assert.ok(uri.startsWith("otpauth://totp/"));
  assert.ok(uri.includes(`secret=${secret}`));
  assert.ok(uri.includes("digits=6"));
  assert.ok(uri.includes("period=30"));
  assert.ok(uri.includes("algorithm=SHA1"));
});

// ── 백업 코드 ──
test("백업 코드: 10개 생성, 평문은 해시와 분리", () => {
  const { plain, hashed } = generateBackupCodes();
  assert.equal(plain.length, 10);
  assert.equal(hashed.length, 10);
  for (const c of plain) assert.match(c, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/, `형식: ${c}`);
  assert.equal(new Set(plain).size, 10, "중복 없음");
  for (const h of hashed) assert.ok(!plain.some((p) => h.includes(p)), "해시에 평문이 들어가면 안 됨");
});

test("백업 코드: 일치 인덱스 반환, 불일치는 -1", () => {
  const { plain, hashed } = generateBackupCodes(3);
  assert.equal(findBackupCode(plain[1], hashed), 1);
  assert.equal(findBackupCode("ZZZZ-ZZZZ", hashed), -1);
  assert.equal(findBackupCode("", hashed), -1);
});

test("백업 코드: 공백·하이픈·소문자 입력 허용", () => {
  const { plain, hashed } = generateBackupCodes(2);
  const messy = plain[0].toLowerCase().replace("-", " ");
  assert.equal(findBackupCode(messy, hashed), 0);
  assert.equal(normalizeBackupCode(" ab-cd "), "ABCD");
});

test("백업 코드: 같은 코드도 해시는 매번 다름(솔트)", () => {
  const a = hashBackupCode("ABCD-EFGH");
  const b = hashBackupCode("ABCD-EFGH");
  assert.notEqual(a, b);
  assert.equal(findBackupCode("ABCD-EFGH", [a]), 0);
  assert.equal(findBackupCode("ABCD-EFGH", [b]), 0);
});

test("백업 코드: 깨진 해시 항목은 건너뛴다(다른 항목 검증에 영향 없음)", () => {
  const { plain, hashed } = generateBackupCodes(2);
  assert.equal(findBackupCode(plain[1], ["깨진값", hashed[1]]), 1);
});

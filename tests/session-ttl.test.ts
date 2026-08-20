// tests/session-ttl.test.ts — 세션 수명 정책(SESSION_TTL_HOURS) + 연장(재발급) 계약 테스트
// 주의: SESSION_TTL은 모듈 로드 시 고정되므로 import 전에 env를 설정한다 (파일 단위 프로세스 격리 전제).
process.env.SESSION_TTL_HOURS = "2";
process.env.AUTH_SECRET = "test-secret-for-session-ttl-suite-0123456789";

const { createSessionToken, verifySessionToken } = await import("../src/lib/auth-core.ts");

import { test } from "node:test";
import assert from "node:assert/strict";

const payload = {
  userId: 1, username: "admin", displayName: "관리자",
  role: "admin" as const, teamId: null, tv: 0,
};

test("SESSION_TTL_HOURS 반영: exp가 지금+2h(±10s)", () => {
  const token = createSessionToken(payload);
  const v = verifySessionToken(token)!;
  const expected = Date.now() + 2 * 60 * 60 * 1000;
  assert.ok(Math.abs(v.exp - expected) < 10_000, `exp=${v.exp} expected≈${expected}`);
});

test("연장(재발급): 새 토큰의 exp가 이전보다 뒤이고 페이로드는 동일", async () => {
  const t1 = createSessionToken(payload);
  const v1 = verifySessionToken(t1)!;
  await new Promise((r) => setTimeout(r, 20));
  // /api/auth/refresh 와 동일 계약: 검증된 세션의 페이로드로 재발급
  const t2 = createSessionToken({
    userId: v1.userId, username: v1.username, displayName: v1.displayName,
    role: v1.role, teamId: v1.teamId ?? null, tv: v1.tv ?? 0,
  });
  const v2 = verifySessionToken(t2)!;
  assert.ok(v2.exp > v1.exp, "연장 후 exp 증가");
  assert.equal(v2.userId, v1.userId);
  assert.equal(v2.role, v1.role);
  assert.equal(v2.tv, v1.tv, "token_version은 연장으로 변하지 않는다 (강등 감지 유지)");
});

test("연장해도 서명 검증 규칙은 동일: 변조 토큰은 거부", () => {
  const t = createSessionToken(payload);
  const [json] = t.split(".");
  assert.equal(verifySessionToken(`${json}.AAAA`), null);
});

// tests/session-gate.test.ts — 강제 게이트(비밀번호 강제변경 mcp · 2단계 인증 등록 강제 msr)
// 결함: 2단계 인증 미등록 총괄의 비밀번호를 관리자가 초기화 → 아이디로 로그인하면 세션이 mcp+msr 를 함께 갖는다.
//   미들웨어가 두 게이트를 각자 검사해 /change-password ↔ /settings 를 무한 왕복("리디렉션한 횟수가 너무 많습니다").
// 또 세션 재발급(연장·비밀번호 변경)이 플래그를 빠뜨려 강제 게이트가 풀렸다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { forcedGate } from "../src/lib/session-gate.ts";

process.env.AUTH_SECRET = "unit-test-secret-session-gate-4b7e1d";
const { createSessionToken, verifySessionToken, reissueSessionToken } = await import("../src/lib/auth-core.ts");

const FLAGS = [{}, { mcp: true }, { msr: true }, { mcp: true, msr: true }];
const PATHS = ["/", "/assets", "/settings", "/change-password", "/api/assets", "/feedback"];

/** 브라우저처럼 리다이렉트를 따라간다 — 끝까지 가면 도착 경로, 순환하면 throw */
function follow(flags: { mcp?: boolean; msr?: boolean }, start: string): string {
  let path = start;
  for (let hop = 0; hop < 5; hop++) {
    const g = forcedGate(flags, path);
    if (!g) return path;
    path = g.page.split("?")[0];
  }
  throw new Error(`리다이렉트 순환: ${JSON.stringify(flags)} ${start}`);
}

test("어떤 플래그 조합·경로에서도 리다이렉트는 한 번 안에 멈춘다 (mcp+msr 무한 왕복 회귀)", () => {
  for (const f of FLAGS) for (const p of PATHS) follow(f, p);
  // 결함 재현 조합: 두 화면 모두 변경 화면으로 수렴해야 한다
  const both = { mcp: true, msr: true };
  assert.equal(follow(both, "/"), "/change-password");
  assert.equal(follow(both, "/settings"), "/change-password");
  assert.equal(forcedGate(both, "/change-password"), null, "변경 화면은 열린다");
});

test("게이트 순서: 비밀번호 변경이 먼저, 등록은 그다음 · API 는 403 코드", () => {
  assert.deepEqual(forcedGate({ mcp: true, msr: true }, "/api/assets"), { error: "PASSWORD_CHANGE_REQUIRED", page: "/change-password" });
  assert.deepEqual(forcedGate({ msr: true }, "/"), { error: "MFA_SETUP_REQUIRED", page: "/settings?tab=mfa&required=1" });
  assert.deepEqual(forcedGate({ msr: true }, "/change-password"), { error: "MFA_SETUP_REQUIRED", page: "/settings?tab=mfa&required=1" });
  assert.equal(forcedGate({ msr: true }, "/settings"), null);
  assert.deepEqual(forcedGate({ mcp: true }, "/settings"), { error: "PASSWORD_CHANGE_REQUIRED", page: "/change-password" });
  assert.equal(forcedGate({}, "/assets"), null);
});

test("재발급: 강제 플래그를 그대로 싣고 patch 만 덮는다", () => {
  const base = { userId: 1, username: "admin@x", displayName: "총괄", role: "admin" as const, teamId: null, tv: 3 };
  const both = verifySessionToken(createSessionToken({ ...base, mcp: true, msr: true }))!;
  const extended = verifySessionToken(reissueSessionToken(both))!;
  assert.equal(extended.mcp, true, "연장해도 비밀번호 강제변경 유지");
  assert.equal(extended.msr, true, "연장해도 등록 강제 유지");
  // 비밀번호 변경 완료: mcp 만 풀리고 msr 는 남아 다음 화면이 등록 화면이 된다
  const changed = verifySessionToken(reissueSessionToken(both, { tv: 4, mcp: false }))!;
  assert.equal(changed.mcp, false);
  assert.equal(changed.msr, true);
  assert.equal(changed.tv, 4);
  assert.equal(follow(changed, "/"), "/settings");
});

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? routeFiles(p) : n === "route.ts" ? [p] : [];
  });
}

test("로그인 중 재발급은 reissueSessionToken 으로만 — 새 토큰을 직접 만드는 곳은 로그인(비밀번호·2단계 코드)뿐", () => {
  const apiRoot = join(process.cwd(), "src", "app", "api");
  const direct = routeFiles(apiRoot)
    .filter((f) => /\bcreateSessionToken\(/.test(readFileSync(f, "utf8")))
    .map((f) => relative(apiRoot, f).split(sep).join("/"))
    .sort();
  assert.deepEqual(direct, ["auth/login/route.ts", "auth/mfa/route.ts"]);
});

test("미들웨어는 강제 게이트를 forcedGate 하나로 판정한다 (플래그를 따로 검사하지 않는다)", () => {
  const src = readFileSync(join(process.cwd(), "src", "middleware.ts"), "utf8");
  assert.match(src, /forcedGate\(payload, pathname\)/);
  assert.doesNotMatch(src, /payload\.(mcp|msr)/);
});

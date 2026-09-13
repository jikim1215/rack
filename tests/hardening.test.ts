// tests/hardening.test.ts — 운영 결함 수정분(업로드 상한·비밀번호 정책 동형 모듈·MFA 강제 역할·assets 인덱스·verified 컬럼)
process.env.AUTH_SECRET = "test-secret-for-hardening-suite-0123456789";

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertUploadSize, assertRowLimit, UPLOAD_MAX_BYTES, UPLOAD_MAX_ROWS } from "../src/lib/validation/upload.ts";
import { ValidationError } from "../src/lib/validation/input.ts";
import { validatePasswordPolicy } from "../src/lib/password-policy.ts";

// ── 업로드 상한 ──
test("assertUploadSize: 없음/빈 파일/초과는 400, 경계값 통과", () => {
  assert.throws(() => assertUploadSize(null), ValidationError);
  assert.throws(() => assertUploadSize({ size: 0 }), /빈 파일/);
  assert.throws(() => assertUploadSize({ size: UPLOAD_MAX_BYTES + 1 }), /너무 큽니다/);
  assert.doesNotThrow(() => assertUploadSize({ size: UPLOAD_MAX_BYTES }));
  assert.doesNotThrow(() => assertUploadSize({ size: 1 }));
});

test("assertRowLimit: 상한 초과만 거부", () => {
  assert.doesNotThrow(() => assertRowLimit(UPLOAD_MAX_ROWS));
  assert.throws(() => assertRowLimit(UPLOAD_MAX_ROWS + 1), /행이 너무 많습니다/);
});

// ── 비밀번호 정책 (클라이언트와 공유되는 동형 모듈 — 서버 auth-core 와 같은 함수여야 한다) ──
test("validatePasswordPolicy: auth-core 재수출과 동일 객체", async () => {
  const core = await import("../src/lib/auth-core.ts");
  assert.equal(core.validatePasswordPolicy, validatePasswordPolicy);
});

test("validatePasswordPolicy: 영문만 8자는 정책 위반, 영문+숫자는 통과", () => {
  assert.match(validatePasswordPolicy("abcdefgh") ?? "", /2종 이상/);
  assert.equal(validatePasswordPolicy("admin123"), null);
  assert.match(validatePasswordPolicy("Ab1") ?? "", /8자 이상/);
  assert.match(validatePasswordPolicy(123 as unknown as string) ?? "", /입력/);
});

// ── MFA 강제 역할 ──
test("mfaRequiredRoles: 기본 admin, none 이면 비움, 목록 파싱, 미지 역할 무시", async () => {
  const { mfaRequiredRoles } = await import("../src/lib/auth-core.ts");
  const saved = process.env.MFA_REQUIRED_ROLES;
  try {
    delete process.env.MFA_REQUIRED_ROLES;
    assert.deepEqual([...mfaRequiredRoles()], ["admin"]);
    process.env.MFA_REQUIRED_ROLES = "none";
    assert.equal(mfaRequiredRoles().size, 0);
    process.env.MFA_REQUIRED_ROLES = " admin , TEAM ,bogus";
    assert.deepEqual([...mfaRequiredRoles()].sort(), ["admin", "team"]);
    process.env.MFA_REQUIRED_ROLES = "";
    assert.equal(mfaRequiredRoles().size, 0);
  } finally {
    if (saved === undefined) delete process.env.MFA_REQUIRED_ROLES; else process.env.MFA_REQUIRED_ROLES = saved;
  }
});

test("세션 토큰: msr 플래그 왕복, 대기 토큰(pur=mfa)은 msr 와 별개", async () => {
  const { createSessionToken, verifySessionToken, createMfaPendingToken } = await import("../src/lib/auth-core.ts");
  const base = { userId: 1, username: "a@x", displayName: "A", role: "admin" as const, teamId: null, tv: 0 };
  const t = verifySessionToken(createSessionToken({ ...base, msr: true }))!;
  assert.equal(t.msr, true);
  assert.equal(t.pur, undefined);
  const p = verifySessionToken(createMfaPendingToken(base))!;
  assert.equal(p.pur, "mfa");
  assert.equal(p.msr, undefined);
});

// ── 스키마: 인덱스 + verified 컬럼 (임시 DB) ──
const dir = mkdtempSync(join(tmpdir(), "asset-hardening-"));
process.env.ASSET_DB_PATH = join(dir, "t.db");
const { getDb } = await import("../src/lib/db.ts");
const db = getDb();

test("schema: assets 인덱스(created/name/serial/verified) + verified_at/verified_by 컬럼", () => {
  const idx = new Set((db.prepare("PRAGMA index_list(assets)").all() as { name: string }[]).map((r) => r.name));
  for (const n of ["idx_assets_created", "idx_assets_name", "idx_assets_serial", "idx_assets_verified"]) assert.ok(idx.has(n), n);
  const cols = new Set((db.prepare("PRAGMA table_info(assets)").all() as { name: string }[]).map((r) => r.name));
  assert.ok(cols.has("verified_at") && cols.has("verified_by"));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

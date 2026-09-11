// tests/authz-menu.test.ts — 메뉴 권한(menu_permissions) 서버 강제 정책(P1)
// admin 항상 통과 · DB 행 우선 · 행 없으면 레지스트리 기본값 · 미지 메뉴 deny · 접근 없으면 쓰기/승인도 없음
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  menuPermission, assertMenuAccess, assertMenuWrite, assertMenuApprove, AuthzError, actorFromSession,
} from "../src/lib/authz.ts";
import type { Actor } from "../src/lib/authz.ts";
import { MENUS } from "../src/lib/menus.ts";

const admin: Actor = { userId: 1, username: "admin", role: "admin", teamId: null, perms: {} };
const teamNoRows: Actor = { userId: 2, username: "t", role: "team", teamId: 1, perms: {} };
const teamRows: Actor = {
  userId: 3, username: "t2", role: "team", teamId: 1,
  perms: {
    contracts: { access: true, write: true, approve: false },   // 기본값(0,0,0)을 DB 행이 덮어씀
    assets: { access: false, write: true, approve: true },      // 접근 꺼짐 → 쓰기/승인도 무효
    movements: { access: true, write: true, approve: true },
  },
};
const viewer: Actor = { userId: 4, username: "v", role: "viewer", teamId: null, perms: {} };

function status(fn: () => void): number | null {
  try { fn(); return null; } catch (e) { return e instanceof AuthzError ? e.status : -1; }
}

test("admin 은 모든 메뉴 접근/쓰기/승인 (DB 행 무관)", () => {
  for (const m of MENUS) {
    assert.deepEqual(menuPermission(admin, m.key), { access: true, write: true, approve: true });
  }
  assert.equal(status(() => assertMenuApprove(admin, "contracts")), null);
});

test("DB 행이 없으면 레지스트리 기본값을 따른다 (team: contracts 접근 불가, assets 쓰기 가능)", () => {
  assert.equal(menuPermission(teamNoRows, "contracts").access, false);
  assert.equal(menuPermission(teamNoRows, "assets").write, true);
  assert.equal(menuPermission(teamNoRows, "movements").approve, false);
  assert.equal(status(() => assertMenuAccess(teamNoRows, "contracts")), 403);
  assert.equal(status(() => assertMenuWrite(teamNoRows, "assets")), null);
  assert.equal(status(() => assertMenuWrite(teamNoRows, "racks")), 403, "racks 기본 team 쓰기 없음");
});

test("DB 행이 있으면 기본값보다 우선한다", () => {
  assert.equal(status(() => assertMenuWrite(teamRows, "contracts")), null, "행에서 열어준 계약 쓰기 통과");
  assert.equal(status(() => assertMenuApprove(teamRows, "movements")), null);
});

test("접근이 꺼진 메뉴는 쓰기/승인 행 값과 무관하게 전부 거부", () => {
  assert.deepEqual(menuPermission(teamRows, "assets"), { access: false, write: false, approve: false });
  assert.equal(status(() => assertMenuWrite(teamRows, "assets")), 403);
});

test("미지 메뉴 키 / 미인증은 deny (미인증 401, 권한 없음 403)", () => {
  assert.equal(menuPermission(viewer, "nope").access, false);
  assert.equal(status(() => assertMenuAccess(null, "assets")), 401);
  assert.equal(status(() => assertMenuAccess(viewer, "nope")), 403);
});

test("총괄 전용 메뉴(logs)는 DB 행이 열려 있어도 비관리자 deny", () => {
  const t: Actor = { ...teamNoRows, perms: { logs: { access: true, write: true, approve: true } } };
  assert.deepEqual(menuPermission(t, "logs"), { access: false, write: false, approve: false });
  assert.equal(status(() => assertMenuAccess(t, "logs")), 403);
  assert.equal(menuPermission(admin, "logs").access, true);
});

test("viewer 기본값: feedback 은 쓰기 가능, distribution 은 접근 불가", () => {
  assert.equal(menuPermission(viewer, "feedback").write, true);
  assert.equal(menuPermission(viewer, "distribution").access, false);
});

test("actorFromSession 은 perms 를 그대로 싣는다 (기본 빈 객체)", () => {
  const a = actorFromSession({ userId: 9, username: "x", displayName: "", role: "team", teamId: 2, exp: Date.now() + 1000 });
  assert.deepEqual(a?.perms, {});
  const b = actorFromSession(
    { userId: 9, username: "x", displayName: "", role: "team", teamId: 2, exp: Date.now() + 1000 },
    { assets: { access: true, write: false, approve: false } },
  );
  assert.equal(b?.perms.assets?.write, false);
});

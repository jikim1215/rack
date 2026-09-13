// tests/asset-list.test.ts — 자산 목록 서버 페이지네이션 (API·페이지 SSR 공용 쿼리)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor } from "../src/lib/authz.ts";
import { listAssets, parseAssetListParams, ASSET_PAGE_DEFAULT, ASSET_PAGE_MAX } from "../src/lib/asset-list.ts";

const dir = mkdtempSync(join(tmpdir(), "asset-list-"));
process.env.ASSET_DB_PATH = join(dir, "t.db");
const { getDb } = await import("../src/lib/db.ts");
const db = getDb();
const admin: Actor = { userId: 1, username: "admin", role: "admin", teamId: null, perms: {} };
const teamA: Actor = { userId: 2, username: "a", role: "team", teamId: 0, perms: {} };

before(() => {
  const aId = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('A')").run().lastInsertRowid);
  const bId = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('B')").run().lastInsertRowid);
  teamA.teamId = aId;
  const ins = db.prepare(`INSERT INTO assets (asset_type, asset_name, ip_address, admin_name, os, serial_number, status, team_id, verified_at, created_at)
                          VALUES (?,?,?,?,?,?,?,?,?,?)`);
  // 250건: A팀 150 / B팀 100. 일부는 IP 없음·관리자 없음·미확인·폐기
  for (let i = 1; i <= 250; i++) {
    const team = i <= 150 ? aId : bId;
    ins.run(
      i % 5 === 0 ? "network" : "server",
      `srv-${String(i).padStart(3, "0")}`,
      i % 4 === 0 ? "" : `10.0.${Math.floor(i / 250)}.${i % 250}`,
      i % 7 === 0 ? "" : "홍길동",
      i % 9 === 0 ? "" : "Rocky 8",
      `SN${i}`,
      i === 3 ? "retired" : "active",
      team,
      i % 3 === 0 ? "" : (i % 3 === 1 ? "2026-09-01 00:00:00" : "2025-01-01 00:00:00"), // 최근 / 오래됨 / 없음
      `2026-01-01 00:00:${String(i % 60).padStart(2, "0")}`,
    );
  }
});
after(() => { try { db.close(); } catch { /* noop */ } rmSync(dir, { recursive: true, force: true }); });

test("기본: limit 100, total 은 필터 적용 전체", () => {
  const r = listAssets(db, admin, {});
  assert.equal(r.rows.length, ASSET_PAGE_DEFAULT);
  assert.equal(r.total, 250);
  assert.equal(r.limit, 100);
});

test("페이지 경계: 마지막 페이지·범위 밖 offset", () => {
  assert.equal(listAssets(db, admin, { limit: 100, offset: 200 }).rows.length, 50);
  assert.equal(listAssets(db, admin, { limit: 100, offset: 9999 }).rows.length, 0);
  assert.equal(listAssets(db, admin, { limit: 5000 }).limit, ASSET_PAGE_MAX, "limit 상한 클램프(응답 메타)");
  assert.equal(listAssets(db, admin, { limit: 0 }).rows.length, 250, "limit=0 은 전량");
});

test("팀 스코프: team 은 자기 팀 자산만 (total 도 스코프 적용)", () => {
  const r = listAssets(db, teamA, {});
  assert.equal(r.total, 150);
  assert.ok(r.rows.every((a) => a.team_id === teamA.teamId));
});

test("필터: type / missing=ip / missing=admin / status", () => {
  assert.equal(listAssets(db, admin, { type: "network" }).total, 50);
  const noIp = listAssets(db, admin, { missing: "ip" });
  assert.ok(noIp.total > 0 && noIp.rows.every((a) => a.ip_address === "" && a.status !== "retired"));
  assert.ok(listAssets(db, admin, { missing: "admin" }).rows.every((a) => a.admin_name === ""));
  assert.equal(listAssets(db, admin, { status: "retired" }).total, 1);
});

test("missing=verify: 확인 이력 없음 + 180일 초과만, 최근 확인은 제외", () => {
  const r = listAssets(db, admin, { missing: "verify", limit: 0 });
  assert.ok(r.total > 0);
  assert.ok(r.rows.every((a) => a.verified_at === "" || a.verified_at.startsWith("2025")));
  assert.ok(!r.rows.some((a) => a.verified_at.startsWith("2026-09")), "최근 확인 자산이 섞이면 안 됨");
});

test("검색 q: 이름 LIKE + 정렬 화이트리스트", () => {
  const r = listAssets(db, admin, { q: "srv-00", sort: "asset_name", dir: "asc" });
  assert.equal(r.total, 9, "srv-001~009");
  assert.equal(r.rows[0].asset_name, "srv-001");
  const p = parseAssetListParams(new URLSearchParams("sort=drop_table&dir=up&limit=abc&missing=zzz&rack_id=-1"));
  assert.equal(p.sort, "created_at", "미지 정렬키 → 기본");
  assert.equal(p.dir, "desc");
  assert.equal(p.limit, ASSET_PAGE_DEFAULT);
  assert.equal(p.missing, "");
  assert.equal(p.rack_id, null);
});

test("withCustomValues: 페이지 행의 값만 (없으면 빈 맵)", () => {
  const r = listAssets(db, admin, { limit: 10, withCustomValues: true });
  assert.ok(r.customValues && typeof r.customValues === "object");
});

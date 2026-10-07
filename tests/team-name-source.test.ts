// tests/team-name-source.test.ts — 관리부서명의 정본은 teams.team_name 하나다.
// 회귀 배경: 대시보드 "최근 등록 자산"·관리대장 "부서명"·내보내기 "부서" 가 assets.department(앱이 쓰지 않는
//            레거시 컬럼, 운영 DB 전부 빈 값)를 읽어, 부서명을 바꿔도 반영되지 않고 늘 빈 칸이었다.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor } from "../src/lib/authz.ts";

const dir = mkdtempSync(join(tmpdir(), "team-name-"));
process.env.ASSET_DB_PATH = join(dir, "t.db");
const { getDb } = await import("../src/lib/db.ts");
const { getDashboardStats } = await import("../src/lib/dashboard-stats.ts");
const db = getDb();
const admin: Actor = { userId: 1, username: "admin", role: "admin", teamId: null, perms: {} };

after(() => { try { db.close(); } catch { /* noop */ } rmSync(dir, { recursive: true, force: true }); });

test("신규 DB 의 assets 에는 department 컬럼이 없다", () => {
  const cols = (db.prepare("PRAGMA table_info(assets)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(!cols.includes("department"));
  assert.ok(cols.includes("team_id"));
});

test("대시보드 최근 자산의 관리부서 = 현재 팀명 (부서명 변경 즉시 반영, 미배정은 null)", () => {
  const teamId = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('정보운영팀')").run().lastInsertRowid);
  const ins = db.prepare("INSERT INTO assets (asset_type, asset_name, team_id, created_at) VALUES ('server', ?, ?, ?)");
  ins.run("배정-1", teamId, "2026-10-07 10:00:00");
  ins.run("미배정-1", null, "2026-10-07 09:00:00");

  const byName = () => new Map(getDashboardStats(db, admin).recentAssets.map((a) => [a.asset_name, a.team_name]));
  assert.equal(byName().get("배정-1"), "정보운영팀");
  assert.equal(byName().get("미배정-1"), null);

  db.prepare("UPDATE teams SET team_name = '디지털인프라팀' WHERE id = ?").run(teamId);
  assert.equal(byName().get("배정-1"), "디지털인프라팀");
});

test("팀 계정은 자기 팀 자산만 최근 자산에 보인다 (teams 조인 후에도 스코프 유지)", () => {
  const other = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('타팀')").run().lastInsertRowid);
  db.prepare("INSERT INTO assets (asset_type, asset_name, team_id, created_at) VALUES ('server', '타팀-1', ?, '2026-10-07 11:00:00')").run(other);
  const mine = Number((db.prepare("SELECT id FROM teams WHERE team_name = '디지털인프라팀'").get() as { id: number }).id);
  const teamActor: Actor = { userId: 2, username: "t", role: "team", teamId: mine, perms: {} };
  const names = getDashboardStats(db, teamActor).recentAssets.map((a) => a.asset_name);
  assert.deepEqual(names, ["배정-1"]);
});

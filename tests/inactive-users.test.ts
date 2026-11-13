// tests/inactive-users.test.ts — 장기 미사용(6개월) 계정 비활성화
// 실제 스키마(getDb = initSchema + 마이그레이션)에서 기준 시각·관리자 보호·재활성화 기준·감사로그를 검사한다.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const dir = mkdtempSync(join(tmpdir(), "inactive-users-"));
process.env.ASSET_DB_PATH = join(dir, "t.db");
const { getDb } = await import("../src/lib/db.ts");
const { findInactiveUsers, deactivateInactiveUsers, recordLogin } = await import("../src/lib/inactive-users.ts");
const db = getDb();

after(() => { try { db.close(); } catch { /* noop */ } rmSync(dir, { recursive: true, force: true }); });

const ago = (days: number) => (db.prepare(`SELECT datetime('now', '-${days} days', 'localtime') AS t`).get() as { t: string }).t;

function addUser(username: string, opts: { role?: string; createdDaysAgo: number; loginDaysAgo?: number; reactivatedDaysAgo?: number; active?: number }) {
  return Number(db.prepare(
    "INSERT INTO users (username, password_hash, role, is_active, created_at, last_login_at, reactivated_at) VALUES (?, 'x', ?, ?, ?, ?, ?)",
  ).run(
    username, opts.role ?? "team", opts.active ?? 1, ago(opts.createdDaysAgo),
    opts.loginDaysAgo === undefined ? null : ago(opts.loginDaysAgo),
    opts.reactivatedDaysAgo === undefined ? null : ago(opts.reactivatedDaysAgo),
  ).lastInsertRowid);
}

beforeEach(() => {
  db.exec("DELETE FROM users");
});

test("기준: 마지막 로그인·생성·재활성화 중 가장 늦은 시각이 6개월 전보다 이르면 대상", () => {
  addUser("admin@x.kr", { role: "admin", createdDaysAgo: 400, loginDaysAgo: 1 });
  addUser("old-login@x.kr", { createdDaysAgo: 400, loginDaysAgo: 200 });
  addUser("recent-login@x.kr", { createdDaysAgo: 400, loginDaysAgo: 30 });
  addUser("never-new@x.kr", { createdDaysAgo: 10 });              // 일괄 등록 직후 — 생성일 기준이라 대상 아님
  addUser("never-old@x.kr", { createdDaysAgo: 200 });             // 한 번도 로그인 안 함 — 생성일 기준 대상
  addUser("reactivated@x.kr", { createdDaysAgo: 400, loginDaysAgo: 300, reactivatedDaysAgo: 5 }); // 재활성화 직후 — 대상 아님
  addUser("already-off@x.kr", { createdDaysAgo: 400, loginDaysAgo: 300, active: 0 });

  const names = findInactiveUsers(db).map((u) => u.username).sort();
  assert.deepEqual(names, ["never-old@x.kr", "old-login@x.kr"]);
});

test("경계: 6개월 하루 전은 대상 아님, 하루 넘으면 대상", () => {
  addUser("admin@x.kr", { role: "admin", createdDaysAgo: 1 });
  addUser("edge-in@x.kr", { createdDaysAgo: 400, loginDaysAgo: 175 });
  addUser("edge-out@x.kr", { createdDaysAgo: 400, loginDaysAgo: 186 });
  assert.deepEqual(findInactiveUsers(db).map((u) => u.username), ["edge-out@x.kr"]);
});

test("마지막 활성 총괄은 남긴다 — 총괄이 전부 대상이면 가장 최근에 활동한 한 명 제외", () => {
  addUser("a-oldest@x.kr", { role: "admin", createdDaysAgo: 900, loginDaysAgo: 500 });
  addUser("a-newer@x.kr", { role: "admin", createdDaysAgo: 900, loginDaysAgo: 250 });
  addUser("team@x.kr", { createdDaysAgo: 900, loginDaysAgo: 400 });
  const names = findInactiveUsers(db).map((u) => u.username).sort();
  assert.deepEqual(names, ["a-oldest@x.kr", "team@x.kr"]);
});

test("활동 중인 총괄이 있으면 오래된 총괄도 대상", () => {
  addUser("a-active@x.kr", { role: "admin", createdDaysAgo: 900, loginDaysAgo: 1 });
  addUser("a-stale@x.kr", { role: "admin", createdDaysAgo: 900, loginDaysAgo: 300 });
  assert.deepEqual(findInactiveUsers(db).map((u) => u.username), ["a-stale@x.kr"]);
});

test("비활성화: is_active=0, 세션 무효화(token_version+1), 계정마다 감사로그", () => {
  addUser("admin@x.kr", { role: "admin", createdDaysAgo: 400, loginDaysAgo: 1 });
  const id = addUser("stale@x.kr", { createdDaysAgo: 400, loginDaysAgo: 200 });
  const before = db.prepare("SELECT COUNT(*) AS c FROM audit_logs").get() as { c: number };

  const done = deactivateInactiveUsers(db, "system");
  assert.deepEqual(done.map((u) => u.username), ["stale@x.kr"]);
  const row = db.prepare("SELECT is_active, token_version FROM users WHERE id = ?").get(id) as { is_active: number; token_version: number };
  assert.equal(row.is_active, 0);
  assert.equal(row.token_version, 1);
  const audits = db.prepare("SELECT * FROM audit_logs WHERE entity_type = 'user' AND entity_id = ? ORDER BY id DESC").all(id) as { changed_by: string; new_values: string }[];
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM audit_logs").get() as { c: number }).c, before.c + 1);
  assert.equal(audits[0].changed_by, "system");
  assert.equal(JSON.parse(audits[0].new_values).is_active, 0);

  // 다시 돌려도 이미 잠긴 계정은 건드리지 않는다
  assert.equal(deactivateInactiveUsers(db, "system").length, 0);
});

test("recordLogin 이 last_login_at 을 지금으로 갱신해 대상에서 빠진다", () => {
  addUser("admin@x.kr", { role: "admin", createdDaysAgo: 400, loginDaysAgo: 1 });
  const id = addUser("back@x.kr", { createdDaysAgo: 400, loginDaysAgo: 200 });
  assert.equal(findInactiveUsers(db).length, 1);
  recordLogin(db, id);
  assert.equal(findInactiveUsers(db).length, 0);
});

test("마이그레이션: 기존 DB 에 last_login_at 을 추가하며 접속기록의 마지막 로그인 성공으로 채운다", async () => {
  const legacyPath = join(dir, "legacy.db");
  const legacy = new Database(legacyPath);
  legacy.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT '', role TEXT NOT NULL DEFAULT 'team' CHECK(role IN ('admin','team','viewer')),
      is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE access_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT DEFAULT '', ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '', action TEXT NOT NULL CHECK(action IN ('login','logout','fail')), result_code TEXT DEFAULT '',
      failure_reason TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')));
    INSERT INTO users (id, username, password_hash) VALUES (1, 'a@x.kr', 'x'), (2, 'b@x.kr', 'x');
    INSERT INTO access_logs (user_id, action, result_code, created_at) VALUES
      (1, 'login', '200', '2026-03-01 09:00:00'),
      (1, 'login', '200', '2026-05-01 09:00:00'),
      (1, 'fail', '200', '2026-09-01 09:00:00'),   -- 2단계 인증 대기(성공 아님)
      (2, 'fail', '401', '2026-09-01 09:00:00');
  `);
  legacy.close();

  const { execFileSync } = await import("node:child_process");
  const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", `
    const { getDb } = await import(${JSON.stringify(new URL("../src/lib/db.ts", import.meta.url).href)});
    const rows = getDb().prepare("SELECT id, last_login_at, reactivated_at FROM users ORDER BY id").all();
    process.stdout.write(JSON.stringify(rows));
  `], { env: { ...process.env, ASSET_DB_PATH: legacyPath, NODE_ENV: "test" }, encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), [
    { id: 1, last_login_at: "2026-05-01 09:00:00", reactivated_at: null },
    { id: 2, last_login_at: null, reactivated_at: null },
  ]);
});

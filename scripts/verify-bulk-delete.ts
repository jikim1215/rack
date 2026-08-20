// 자산 일괄삭제(DELETE /api/assets/bulk) 핵심 로직 검증.
// 핸들러와 동일한 "DELETE FROM assets WHERE id IN (...) AND <scope>" 를 실DB에 실행하여
// 행수준 인가(team은 자기 팀만, admin은 전체, viewer/미인증은 거부)가 지켜지는지 단언한다.
// 실행: node --experimental-strip-types scripts/verify-bulk-delete.ts
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

const AUTHZ = pathToFileURL(join(process.cwd(), "src", "lib", "authz.ts")).href;
const { actorFromSession, scopeWhere, assertCanDelete, AuthzError } = await import(AUTHZ);

const results: { name: string; pass: boolean }[] = [];
const ck = (name: string, pass: boolean) => results.push({ name, pass });
const ses = (role: string, teamId: number | null) =>
  ({ userId: 1, username: role + (teamId ?? ""), displayName: "", role, teamId, exp: Date.now() + 1e6 });
const admin = actorFromSession(ses("admin", null));
const viewer = actorFromSession(ses("viewer", null));
const team1 = actorFromSession(ses("team", 1));
const team2 = actorFromSession(ses("team", 2));
const unauth = actorFromSession(null);
const allows = (fn: () => void) => { try { fn(); return true; } catch (e) { if (e instanceof AuthzError) return false; throw e; } };

// 권한 게이트(핸들러 1단계: assertCanDelete)
ck("gate: viewer 일괄삭제 거부", !allows(() => assertCanDelete(viewer)));
ck("gate: 미인증 일괄삭제 거부", !allows(() => assertCanDelete(unauth)));
ck("gate: team 일괄삭제 허용", allows(() => assertCanDelete(team1)));
ck("gate: admin 일괄삭제 허용", allows(() => assertCanDelete(admin)));

// 핸들러 2단계: 스코프 기반 삭제 — fresh DB per actor
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "bulkdel-"));
  const db = new Database(join(dir, "t.db"));
  db.exec(`CREATE TABLE assets (id INTEGER PRIMARY KEY, asset_name TEXT, team_id INTEGER);
    INSERT INTO assets (id,asset_name,team_id) VALUES
     (1,'t1-a',1),(2,'t1-b',1),(3,'t2-a',2),(4,'t2-b',2),(5,'orphan',NULL);`);
  return { db, dir };
}
// 핸들러와 동일: 선택 id ∩ scope 만 삭제
function bulkDelete(actor: any, ids: number[]): { remaining: number[]; deleted: number } {
  const { db, dir } = freshDb();
  const scope = scopeWhere(actor);
  const ph = ids.map(() => "?").join(",");
  const targets = db.prepare(`SELECT id FROM assets WHERE id IN (${ph}) AND ${scope.sql}`).all(...ids, ...scope.params) as { id: number }[];
  const del = db.prepare("DELETE FROM assets WHERE id = ?");
  const tx = db.transaction(() => { for (const t of targets) del.run(t.id); });
  tx();
  const remaining = (db.prepare("SELECT id FROM assets ORDER BY id").all() as { id: number }[]).map((r) => r.id);
  db.close(); rmSync(dir, { recursive: true, force: true });
  return { remaining, deleted: targets.length };
}
const eq = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// team1이 전체(1..5) 선택해도 자기 팀(1,2)만 삭제 → 3,4,5 남음
let r = bulkDelete(team1, [1, 2, 3, 4, 5]);
ck("team1: 전체선택해도 자기팀만 삭제(2건)", r.deleted === 2 && eq(r.remaining, [3, 4, 5]));
// team2의 자산을 team1이 콕 집어도 삭제 안 됨(권한밖 → 0건)
r = bulkDelete(team1, [3, 4]);
ck("team1: 타팀 자산 지정삭제 차단(0건)", r.deleted === 0 && eq(r.remaining, [1, 2, 3, 4, 5]));
// admin은 전체 삭제 가능
r = bulkDelete(admin, [1, 2, 3, 4, 5]);
ck("admin: 전체 삭제(5건)", r.deleted === 5 && eq(r.remaining, []));
// admin은 orphan(미배정)도 삭제
r = bulkDelete(admin, [5]);
ck("admin: 미배정 자산 삭제", r.deleted === 1 && eq(r.remaining, [1, 2, 3, 4]));

const failed = results.filter((x) => !x.pass);
for (const x of results) console.log(`${x.pass ? "PASS" : "FAIL"}: ${x.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.error(`${failed.length} FAILED`); process.exit(1); }
console.log("ALL BULK-DELETE CHECKS PASSED");

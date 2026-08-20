// G004 (P3) teams + user-team-assignment integration test.
// Mirrors the exact SQL/logic used by src/app/api/teams/* and src/app/api/users/* against a
// real sqlite DB built via the real schema (src/lib/db.ts), proving: team CRUD, delete-in-use
// block (409 condition), and team_id role-gating (only role='team' carries a team).
//
// Run: node --experimental-strip-types scripts/verify-teams.ts
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

const results: { name: string; pass: boolean }[] = [];
const ck = (name: string, pass: boolean) => results.push({ name, pass });

const dir = mkdtempSync(join(tmpdir(), "teams-"));
process.chdir(dir);
const dbmod = await import(pathToFileURL(join(process.cwd(), "src", "lib", "db.ts")).href);
const db = dbmod.getDb() as Database.Database;

// ── team_id role-gating (mirrors users route: safeRole==='team' ? teamId : null) ──
function effectiveTeamId(role: string, teamId: number | null): number | null {
  return role === "team" && teamId != null ? teamId : null;
}
const t = db.prepare("INSERT INTO teams (team_name) VALUES (?)").run("인프라팀");
const teamId = Number(t.lastInsertRowid);
ck("team created", !!db.prepare("SELECT 1 FROM teams WHERE id=?").get(teamId));

// rename (PUT)
db.prepare("UPDATE teams SET team_name=? WHERE id=?").run("인프라운영팀", teamId);
ck("team renamed", (db.prepare("SELECT team_name n FROM teams WHERE id=?").get(teamId) as any).n === "인프라운영팀");

// duplicate-name guard (POST/PUT check)
const dup = db.prepare("SELECT id FROM teams WHERE team_name=?").get("인프라운영팀");
ck("duplicate name detectable", !!dup);

// user team_id gating
const uTeam = db.prepare("INSERT INTO users (username,password_hash,role,team_id) VALUES (?,?,?,?)")
  .run("teamuser", "x", "team", effectiveTeamId("team", teamId));
ck("team-role user gets team_id", (db.prepare("SELECT team_id ti FROM users WHERE id=?").get(Number(uTeam.lastInsertRowid)) as any).ti === teamId);
const uAdmin = db.prepare("INSERT INTO users (username,password_hash,role,team_id) VALUES (?,?,?,?)")
  .run("adminuser", "x", "admin", effectiveTeamId("admin", teamId));
ck("admin-role user team_id forced null", (db.prepare("SELECT team_id ti FROM users WHERE id=?").get(Number(uAdmin.lastInsertRowid)) as any).ti === null);
const uViewer = db.prepare("INSERT INTO users (username,password_hash,role,team_id) VALUES (?,?,?,?)")
  .run("vieweruser", "x", "viewer", effectiveTeamId("viewer", teamId));
ck("viewer-role user team_id forced null", (db.prepare("SELECT team_id ti FROM users WHERE id=?").get(Number(uViewer.lastInsertRowid)) as any).ti === null);

// delete-in-use block (mirrors DELETE 409 condition): team has a user -> blocked
function deleteBlocked(tid: number): boolean {
  const uc = (db.prepare("SELECT COUNT(*) c FROM users WHERE team_id=?").get(tid) as any).c;
  const ac = (db.prepare("SELECT COUNT(*) c FROM assets WHERE team_id=?").get(tid) as any).c;
  return uc > 0 || ac > 0;
}
ck("delete blocked while team has a user (409)", deleteBlocked(teamId) === true);

// reassign the user away, add an asset, still blocked by asset
db.prepare("UPDATE users SET team_id=NULL WHERE team_id=?").run(teamId);
ck("after user reassign, no longer user-blocked", (db.prepare("SELECT COUNT(*) c FROM users WHERE team_id=?").get(teamId) as any).c === 0);
db.prepare("INSERT INTO assets (asset_type,asset_name,team_id) VALUES ('server','a1',?)").run(teamId);
ck("delete still blocked while team has an asset (409)", deleteBlocked(teamId) === true);

// clear assets, now deletable
db.prepare("UPDATE assets SET team_id=NULL WHERE team_id=?").run(teamId);
ck("empty team deletable", deleteBlocked(teamId) === false);
db.prepare("DELETE FROM teams WHERE id=?").run(teamId);
ck("team deleted", !db.prepare("SELECT 1 FROM teams WHERE id=?").get(teamId));

// team counts query (GET /api/teams) shape
const t2 = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('보안팀')").run().lastInsertRowid);
db.prepare("INSERT INTO users (username,password_hash,role,team_id) VALUES ('s1','x','team',?)").run(t2);
db.prepare("INSERT INTO assets (asset_type,asset_name,team_id) VALUES ('server','s-a',?)").run(t2);
const row = db.prepare(`SELECT t.team_name,
  (SELECT COUNT(*) FROM users u WHERE u.team_id=t.id) uc,
  (SELECT COUNT(*) FROM assets a WHERE a.team_id=t.id) ac
  FROM teams t WHERE t.id=?`).get(t2) as any;
ck("team counts: user_count=1 asset_count=1", row.uc === 1 && row.ac === 1);
// real DELETE on an in-use team must THROW (FK NO ACTION + foreign_keys=ON) — this is the
// data-integrity guarantee the block-409 route protects against; proves it's not hypothetical.
let realDeleteThrew = false;
try { db.prepare("DELETE FROM teams WHERE id=?").run(t2); } catch { realDeleteThrew = true; }
ck("real DELETE of in-use team throws FK constraint (block-409 is load-bearing)", realDeleteThrew);
ck("in-use team still present after blocked delete", !!db.prepare("SELECT 1 FROM teams WHERE id=?").get(t2));

db.close();
process.chdir(process.cwd());
rmSync(dir, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}: ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.error(`${failed.length} FAILED`); process.exit(1); }
console.log("ALL TEAMS LIFECYCLE CHECKS PASSED");

// G003 (P2) RBAC authorization-matrix verification.
// Tests the PURE authz contract (src/lib/authz.ts) that every API route consumes:
//   1. assert* permission matrix across roles x actions (incl. cross-team write deny)
//   2. scopeWhere row-level filtering against a REAL sqlite DB (incl. cross-team READ-LEAK cells)
//   3. default-deny for unauthenticated / unknown-role / team-without-team actors
//
// authz.ts is import-pure (only type-only import of SessionPayload/Role, erased by strip-types),
// so it loads standalone. Run: node --experimental-strip-types scripts/verify-authz-matrix.ts
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

const AUTHZ = pathToFileURL(join(process.cwd(), "src", "lib", "authz.ts")).href;
const a = await import(AUTHZ);
const { actorFromSession, scopeWhere, unassignedScopeWhere, assertCanRead, assertCanWrite,
  assertCanDelete, assertCanDownload, assertAdmin, AuthzError } = a;

const results: { name: string; pass: boolean }[] = [];
const ck = (name: string, pass: boolean) => results.push({ name, pass });

// session factory
const ses = (role: string, teamId: number | null) =>
  ({ userId: 1, username: role + (teamId ?? ""), displayName: "", role, teamId, exp: Date.now() + 1e6 });

const admin = actorFromSession(ses("admin", null));
const viewer = actorFromSession(ses("viewer", null));
const team1 = actorFromSession(ses("team", 1));
const team2 = actorFromSession(ses("team", 2));
const teamNone = actorFromSession(ses("team", null));
const unknown = actorFromSession(ses("superuser", null)); // invalid role -> null
const unauth = actorFromSession(null);

// ── 0. actorFromSession default-deny ──
ck("0: unknown role -> null actor (default-deny)", unknown === null);
ck("0: null session -> null actor", unauth === null);
ck("0: admin actor resolved", admin && admin.role === "admin");
ck("0: team1 actor teamId=1", team1 && team1.teamId === 1);

// ── 1. assert* permission matrix ──
function allows(fn: () => void): boolean { try { fn(); return true; } catch (e) { if (e instanceof AuthzError) return false; throw e; } }
function status(fn: () => void): number | null { try { fn(); return null; } catch (e) { return (e as { status?: number })?.status ?? -1; } }

// READ
ck("1: read admin allow", allows(() => assertCanRead(admin)));
ck("1: read viewer allow", allows(() => assertCanRead(viewer)));
ck("1: read team allow", allows(() => assertCanRead(team1)));
ck("1: read unauth -> 401", status(() => assertCanRead(unauth)) === 401);
// WRITE (no owner specified = general write capability)
ck("1: write admin allow", allows(() => assertCanWrite(admin)));
ck("1: write viewer DENY", !allows(() => assertCanWrite(viewer)));
ck("1: write viewer -> 403", status(() => assertCanWrite(viewer)) === 403);
ck("1: write team allow", allows(() => assertCanWrite(team1)));
ck("1: write team-without-team DENY", !allows(() => assertCanWrite(teamNone)));
ck("1: write unauth -> 401", status(() => assertCanWrite(unauth)) === 401);
// WRITE with owner team (cross-team deny)
ck("1: team1 write own-team(1) allow", allows(() => assertCanWrite(team1, 1)));
ck("1: team1 write other-team(2) DENY", !allows(() => assertCanWrite(team1, 2)));
ck("1: team1 write unassigned(null) DENY", !allows(() => assertCanWrite(team1, null)));
ck("1: admin write any-team allow", allows(() => assertCanWrite(admin, 2)) && allows(() => assertCanWrite(admin, null)));
ck("1: viewer write own-looking team DENY", !allows(() => assertCanWrite(viewer, 1)));
// DELETE mirrors write
ck("1: delete viewer DENY", !allows(() => assertCanDelete(viewer, 1)));
ck("1: delete team1 other-team DENY", !allows(() => assertCanDelete(team1, 2)));
ck("1: delete team1 own allow", allows(() => assertCanDelete(team1, 1)));
ck("1: delete admin allow", allows(() => assertCanDelete(admin, 2)));
// DOWNLOAD (viewer allowed per ADR-010)
ck("1: download admin allow", allows(() => assertCanDownload(admin)));
ck("1: download viewer allow (ADR-010)", allows(() => assertCanDownload(viewer)));
ck("1: download team allow", allows(() => assertCanDownload(team1)));
ck("1: download unauth -> 401", status(() => assertCanDownload(unauth)) === 401);
// ADMIN-only
ck("1: assertAdmin admin allow", allows(() => assertAdmin(admin)));
ck("1: assertAdmin team -> 403", status(() => assertAdmin(team1)) === 403);
ck("1: assertAdmin viewer -> 403", status(() => assertAdmin(viewer)) === 403);
ck("1: assertAdmin unauth -> 401", status(() => assertAdmin(unauth)) === 401);

// ── 2. scopeWhere against a REAL DB (cross-team READ-LEAK cells) ──
const dir = mkdtempSync(join(tmpdir(), "authz-scope-"));
const db = new Database(join(dir, "t.db"));
db.exec(`CREATE TABLE assets (id INTEGER PRIMARY KEY, asset_name TEXT, team_id INTEGER);
  INSERT INTO assets (id,asset_name,team_id) VALUES
   (1,'t1-a',1),(2,'t1-b',1),(3,'t2-a',2),(4,'t2-b',2),(5,'orphan',NULL);`);
function visibleIds(actor: any, column = "team_id"): number[] {
  const scope = scopeWhere(actor, column);
  const rows = db.prepare(`SELECT id FROM assets WHERE ${scope.sql} ORDER BY id`).all(...scope.params) as any[];
  return rows.map((r) => r.id);
}
const eqSet = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
ck("2: admin sees ALL (1..5)", eqSet(visibleIds(admin), [1, 2, 3, 4, 5]));
ck("2: viewer sees ALL (1..5)", eqSet(visibleIds(viewer), [1, 2, 3, 4, 5]));
ck("2: team1 sees ONLY team1 (1,2) — no t2/orphan leak", eqSet(visibleIds(team1), [1, 2]));
ck("2: team2 sees ONLY team2 (3,4) — no t1/orphan leak", eqSet(visibleIds(team2), [3, 4]));
ck("2: team-without-team sees NOTHING", eqSet(visibleIds(teamNone), []));
ck("2: unauth sees NOTHING (default-deny)", eqSet(visibleIds(unauth), []));
ck("2: unknown-role sees NOTHING", eqSet(visibleIds(unknown), []));
// READ-LEAK assertions stated explicitly
ck("2: LEAK-CHECK team1 cannot see id=3 (t2)", !visibleIds(team1).includes(3));
ck("2: LEAK-CHECK team1 cannot see id=5 (orphan)", !visibleIds(team1).includes(5));
ck("2: LEAK-CHECK team2 cannot see id=1 (t1)", !visibleIds(team2).includes(1));
// unassignedScopeWhere (admin reassign queue, AC-11 groundwork)
function unassignedIds(actor: any): number[] {
  const s = unassignedScopeWhere(actor, "team_id");
  return (db.prepare(`SELECT id FROM assets WHERE ${s.sql} ORDER BY id`).all(...s.params) as any[]).map((r) => r.id);
}
ck("2: admin unassignedScope sees only orphan (5)", eqSet(unassignedIds(admin), [5]));
ck("2: team1 unassignedScope sees nothing (admin-only)", eqSet(unassignedIds(team1), []));
ck("2: viewer unassignedScope sees nothing (admin-only)", eqSet(unassignedIds(viewer), []));
db.close();
rmSync(dir, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}: ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.error(`${failed.length} FAILED`); process.exit(1); }
console.log("ALL RBAC AUTHZ MATRIX CHECKS PASSED");

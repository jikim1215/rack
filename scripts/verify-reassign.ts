// G005 (P4) unassigned-queue reassignment verification. Calls the REAL shipped logic
// (src/lib/asset-reassign.ts reassignUnassignedAssets) — the exact code the route runs — against a
// real migrated DB. Proves scope=unassigned: only currently-unassigned (team_id NULL) assets are
// reassigned; already-assigned are NEVER stolen; each reassignment is audit-logged.
//
// Run: node --experimental-strip-types scripts/verify-reassign.ts
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

const results: { name: string; pass: boolean }[] = [];
const ck = (n: string, p: boolean) => results.push({ name: n, pass: p });

const dir = mkdtempSync(join(tmpdir(), "reassign-"));
process.chdir(dir);
const dbmod = await import(pathToFileURL(join(process.cwd(), "src", "lib", "db.ts")).href);
// REAL shipped reassign logic shared by the route
const { reassignUnassignedAssets } = await import(
  pathToFileURL(join(process.cwd(), "src", "lib", "asset-reassign.ts")).href
);
const db = dbmod.getDb() as Database.Database;

const t1 = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('인프라팀')").run().lastInsertRowid);
const t2 = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('보안팀')").run().lastInsertRowid);
const u1 = Number(db.prepare("INSERT INTO assets (asset_type,asset_name,team_id) VALUES ('server','u1',NULL)").run().lastInsertRowid);
const u2 = Number(db.prepare("INSERT INTO assets (asset_type,asset_name,team_id) VALUES ('server','u2',NULL)").run().lastInsertRowid);
const u3 = Number(db.prepare("INSERT INTO assets (asset_type,asset_name,team_id) VALUES ('server','u3',NULL)").run().lastInsertRowid);
const a1 = Number(db.prepare("INSERT INTO assets (asset_type,asset_name,team_id) VALUES ('server','already',?)").run(t2).lastInsertRowid);

// bulk reassign u1,u2 + already-assigned a1 -> t1 (a1 must be skipped, not stolen)
const r1 = reassignUnassignedAssets(db, { assetIds: [u1, u2, a1], teamId: t1, actorUsername: "admin" });
ck("bulk reassigned = 2 (a1 skipped)", r1.reassigned === 2);
ck("bulk skipped = 1 (already assigned)", r1.skipped === 1);
ck("u1 now team1", (db.prepare("SELECT team_id ti FROM assets WHERE id=?").get(u1) as any).ti === t1);
ck("u2 now team1", (db.prepare("SELECT team_id ti FROM assets WHERE id=?").get(u2) as any).ti === t1);
ck("a1 NOT stolen (still team2)", (db.prepare("SELECT team_id ti FROM assets WHERE id=?").get(a1) as any).ti === t2);
ck("u3 still unassigned", (db.prepare("SELECT team_id ti FROM assets WHERE id=?").get(u3) as any).ti === null);
const audits = db.prepare("SELECT entity_id,old_values,new_values FROM audit_logs WHERE entity_type='asset' AND action='update'").all() as any[];
ck("2 audit rows written", audits.length === 2);
ck("audit records team_id null->team1", audits.every((a) => JSON.parse(a.old_values).team_id === null && JSON.parse(a.new_values).team_id === t1));

// individual reassign u3 -> t2
const r2 = reassignUnassignedAssets(db, { assetIds: [u3], teamId: t2, actorUsername: "admin" });
ck("individual reassigned u3 = 1", r2.reassigned === 1);
ck("u3 now team2", (db.prepare("SELECT team_id ti FROM assets WHERE id=?").get(u3) as any).ti === t2);

// re-reassign already-assigned u1 -> t2 must be 0 (scope=unassigned protects, real route)
const r3 = reassignUnassignedAssets(db, { assetIds: [u1], teamId: t2, actorUsername: "admin" });
ck("re-reassign assigned u1 -> 0 (scope=unassigned enforced by shipped lib)", r3.reassigned === 0 && r3.skipped === 1);
ck("u1 unchanged after blocked re-reassign (still team1)", (db.prepare("SELECT team_id ti FROM assets WHERE id=?").get(u1) as any).ti === t1);

db.close();
process.chdir(process.cwd());
rmSync(dir, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}: ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.error(`${failed.length} FAILED`); process.exit(1); }
console.log("ALL REASSIGN CHECKS PASSED (against shipped lib)");

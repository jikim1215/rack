// G007 (P6) dashboard cleanup-stats verification. Calls the REAL shipped lib
// (src/lib/dashboard-stats.ts computeCleanupStats) against a real migrated DB. Proves per-team
// counts, import_issue type summary, v_cleanup_queue surfacing, duplicate(동명이기) detection, and
// team scoping (AC-2/13/14).
//
// Run: node --experimental-strip-types scripts/verify-dashboard-stats.ts
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

const results: { name: string; pass: boolean }[] = [];
const ck = (n: string, p: boolean) => results.push({ name: n, pass: p });

const dir = mkdtempSync(join(tmpdir(), "dashstats-"));
process.chdir(dir);
const dbmod = await import(pathToFileURL(join(process.cwd(), "src", "lib", "db.ts")).href);
const { computeCleanupStats } = await import(pathToFileURL(join(process.cwd(), "src", "lib", "dashboard-stats.ts")).href);
const authz = await import(pathToFileURL(join(process.cwd(), "src", "lib", "authz.ts")).href);
const db = dbmod.getDb() as Database.Database;

const ses = (role: string, teamId: number | null) => ({ userId: 1, username: "u", displayName: "", role, teamId, exp: Date.now() + 1e6 });
const admin = authz.actorFromSession(ses("admin", null));
const team1 = authz.actorFromSession(ses("team", 1));
const stats = (actor: any) => computeCleanupStats(db, authz.scopeWhere(actor, "team_id"), authz.scopeWhere(actor, "a.team_id"));

const t1 = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('인프라팀')").run().lastInsertRowid);
const t2 = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('보안팀')").run().lastInsertRowid);

// team1: complete asset, asset missing os+ip, duplicate-name pair (same name, no serial -> 진성 중복 의심)
const a1 = Number(db.prepare("INSERT INTO assets (asset_type,asset_name,team_id,ip_address,os,admin_name,rack_id) VALUES ('server','web-01',?, '10.0.0.1','RHEL8','kim',NULL)").run(t1).lastInsertRowid);
db.prepare("INSERT INTO assets (asset_type,asset_name,team_id,ip_address,os,admin_name) VALUES ('server','needs-fix',?, '','','')").run(t1); // missing ip/os/admin/rack -> cleanup
db.prepare("INSERT INTO assets (asset_type,asset_name,team_id,serial_number,ip_address) VALUES ('server','dupe',?, '','')").run(t1);
db.prepare("INSERT INTO assets (asset_type,asset_name,team_id,serial_number,ip_address) VALUES ('server','dupe',?, '','')").run(t1); // same name, no serial/ip -> likelyDup
// team2: its own asset (must NOT appear for team1)
db.prepare("INSERT INTO assets (asset_type,asset_name,team_id,ip_address,os,admin_name) VALUES ('security','t2-fw',?, '','','')").run(t2);
// import_issues: one ip_format (오류) linked to a1, one missing_os linked to needs-fix, one dup_suspect, one unlinked missing_id
db.prepare("INSERT INTO import_issue (batch_id,issue_type,asset_id) VALUES ('b1','ip_format',?)").run(a1);
const nf = (db.prepare("SELECT id FROM assets WHERE asset_name='needs-fix'").get() as any).id;
db.prepare("INSERT INTO import_issue (batch_id,issue_type,asset_id) VALUES ('b1','missing_os',?)").run(nf);
db.prepare("INSERT INTO import_issue (batch_id,issue_type,asset_id) VALUES ('b1','dup_suspect',?)").run(nf);
db.prepare("INSERT INTO import_issue (batch_id,issue_type,asset_id) VALUES ('b1','missing_id',NULL)").run(); // unlinked raw

// ── admin view ──
const A = stats(admin);
ck("admin byTeam has 인프라팀 (4) + 보안팀 (1)", A.byTeam.find((x: any) => x.team_name === "인프라팀")?.c === 4 && A.byTeam.find((x: any) => x.team_name === "보안팀")?.c === 1);
ck("admin issueSummary error=1 (ip_format)", A.issueSummary.error === 1);
ck("admin issueSummary missing_os=1", A.issueSummary.missing_os === 1);
ck("admin issueSummary dup_suspect=1", A.issueSummary.dup_suspect === 1);
ck("admin issueSummary missing_id=1 (unlinked raw counted for admin)", A.issueSummary.missing_id === 1);
ck("admin cleanupCount >= 3 (needs-fix + 2 dupe missing fields)", A.cleanupCount >= 3);
ck("admin dupSuspect groups=1 (dupe)", A.dupSuspect.groups === 1);
ck("admin dupSuspect assets=2", A.dupSuspect.assets === 2);
ck("admin dupSuspect likelyDup=1 (no serial/ip)", A.dupSuspect.likelyDup === 1);

// ── team1 view: must NOT see team2 ──
const T = stats(team1);
ck("team1 byTeam only 인프라팀 (no 보안팀 leak)", T.byTeam.length === 1 && T.byTeam[0].team_name === "인프라팀" && T.byTeam[0].c === 4);
ck("team1 cleanupQueue excludes t2-fw", !T.cleanupQueue.some((q: any) => q.asset_name === "t2-fw"));
ck("team1 missing_id unlinked NOT counted (admin-only raw)", T.issueSummary.missing_id === 0);
ck("team1 sees own ip_format error=1", T.issueSummary.error === 1);

db.close();
process.chdir(process.cwd());
rmSync(dir, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}: ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.error(`${failed.length} FAILED`); process.exit(1); }
console.log("ALL DASHBOARD CLEANUP-STATS CHECKS PASSED (against shipped lib)");

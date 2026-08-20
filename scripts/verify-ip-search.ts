// G009 (P8/AC-5) multi-IP search verification using the REAL shipped clause (src/lib/asset-search.ts
// ipSearchClause) against a real migrated DB. Exercises ALL THREE IP sources (representative
// assets.ip_address, asset_ips vip, custom_values additional_ips) + team scoping (no cross-team leak).
//
// Run: node --experimental-strip-types scripts/verify-ip-search.ts
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

const results: { name: string; pass: boolean }[] = [];
const ck = (n: string, p: boolean) => results.push({ name: n, pass: p });

const dir = mkdtempSync(join(tmpdir(), "ipsearch-"));
process.chdir(dir);
const dbmod = await import(pathToFileURL(join(process.cwd(), "src", "lib", "db.ts")).href);
const { ipSearchClause } = await import(pathToFileURL(join(process.cwd(), "src", "lib", "asset-search.ts")).href);
const authz = await import(pathToFileURL(join(process.cwd(), "src", "lib", "authz.ts")).href);
const db = dbmod.getDb() as Database.Database;

const ses = (role: string, teamId: number | null) => ({ userId: 1, username: "u", displayName: "", role, teamId, exp: Date.now() + 1e6 });
const admin = authz.actorFromSession(ses("admin", null));
const team1 = authz.actorFromSession(ses("team", 1));

const t1 = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('t1')").run().lastInsertRowid);
const t2 = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('t2')").run().lastInsertRowid);
const addlField = Number(db.prepare("INSERT INTO custom_fields (field_key, field_label, field_type) VALUES ('additional_ips','추가 IP','multi-text')").run().lastInsertRowid);

// A1 (t1): representative ip 10.1.1.1
const a1 = Number(db.prepare("INSERT INTO assets (asset_type,asset_name,team_id,ip_address) VALUES ('server','rep',?, '10.1.1.1')").run(t1).lastInsertRowid);
// A2 (t1): asset_ips vip 10.2.2.2 (representative different)
const a2 = Number(db.prepare("INSERT INTO assets (asset_type,asset_name,team_id,ip_address) VALUES ('network','vip',?, '10.9.9.9')").run(t1).lastInsertRowid);
db.prepare("INSERT INTO asset_ips (asset_id,ip_address,ip_type) VALUES (?, '10.2.2.2','vip')").run(a2);
// A3 (t1): custom_values additional_ips containing 10.3.3.3
const a3 = Number(db.prepare("INSERT INTO assets (asset_type,asset_name,team_id,ip_address) VALUES ('server','addl',?, '10.8.8.8')").run(t1).lastInsertRowid);
db.prepare("INSERT INTO custom_values (asset_id,field_id,value) VALUES (?,?,?)").run(a3, addlField, JSON.stringify(["10.3.3.3", "10.3.3.4"]));
// A4 (t2): representative 10.4.4.4 — must be invisible to team1 search
const a4 = Number(db.prepare("INSERT INTO assets (asset_type,asset_name,team_id,ip_address) VALUES ('server','t2-rep',?, '10.4.4.4')").run(t2).lastInsertRowid);
// A5 (t2): asset_ips vip 10.1.1.1 (SAME as A1's rep) — team1 search for 10.1.1.1 must NOT return A5
const a5 = Number(db.prepare("INSERT INTO assets (asset_type,asset_name,team_id,ip_address) VALUES ('server','t2-collide',?, '10.50.0.5')").run(t2).lastInsertRowid);
db.prepare("INSERT INTO asset_ips (asset_id,ip_address,ip_type) VALUES (?, '10.1.1.1','vip')").run(a5);

function searchIds(actor: any, q: string): number[] {
  const scope = authz.scopeWhere(actor, "a.team_id");
  const ip = ipSearchClause(q, "a");
  return (db.prepare(`SELECT a.id FROM assets a WHERE ${scope.sql} AND ${ip.sql} ORDER BY a.id`).all(...scope.params, ...ip.params) as any[]).map((r) => r.id);
}

// admin: all 3 sources match
ck("admin search representative ip -> A1", searchIds(admin, "10.1.1.1").includes(a1));
ck("admin search asset_ips vip -> A2", searchIds(admin, "10.2.2.2").includes(a2));
ck("admin search custom_values additional_ips -> A3", searchIds(admin, "10.3.3.3").includes(a3));
ck("admin partial match (10.3.3) -> A3", searchIds(admin, "10.3.3").includes(a3));
ck("admin non-existent ip -> none", searchIds(admin, "10.250.250.250").length === 0);
ck("admin rep search does NOT over-match A2/A3", !searchIds(admin, "10.1.1.1").includes(a2) && !searchIds(admin, "10.1.1.1").includes(a3));

// team1 scoping: only own-team assets in results
const t1Rep = searchIds(team1, "10.1.1.1");
ck("team1 search 10.1.1.1 includes own A1", t1Rep.includes(a1));
ck("LEAK-CHECK team1 search 10.1.1.1 excludes t2 A5 (same ip, other team)", !t1Rep.includes(a5));
ck("team1 vip search includes own A2", searchIds(team1, "10.2.2.2").includes(a2));
ck("team1 additional_ips search includes own A3", searchIds(team1, "10.3.3.3").includes(a3));
ck("LEAK-CHECK team1 cannot find t2 A4 via 10.4.4.4", !searchIds(team1, "10.4.4.4").includes(a4) && searchIds(team1, "10.4.4.4").length === 0);

db.close();
process.chdir(process.cwd());
rmSync(dir, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}: ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.error(`${failed.length} FAILED`); process.exit(1); }
console.log("ALL MULTI-IP SEARCH CHECKS PASSED (real ipSearchClause, all 3 sources + scoping)");

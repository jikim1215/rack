// Minimal e2e seed for G004 settings UI verification: builds a FRESH migrated DB via the real
// src/lib/db.ts initSchema (no legacy db-seed schema), then inserts an admin, a team user, two
// teams, and cross-team assets, with login-compatible password hashes
// (stored = scrypt(sha512hex(plaintext))). Run from project root:
//   node --experimental-strip-types scripts/e2e-seed.ts
import { scryptSync, randomBytes, createHash } from "crypto";
import { rmSync, existsSync } from "fs";
import { pathToFileURL } from "url";
import { join } from "path";

for (const f of ["data.db", "data.db-wal", "data.db-shm"]) {
  if (existsSync(f)) rmSync(f, { force: true });
}
const { getDb } = await import(pathToFileURL(join(process.cwd(), "src", "lib", "db.ts")).href);
const db = getDb();

function sha512hex(s: string): string { return createHash("sha512").update(s).digest("hex"); }
function hashPassword(plaintext: string): string {
  const pre = sha512hex(plaintext); // mirror client SHA-512 pre-hash
  const salt = randomBytes(32).toString("hex");
  const hash = scryptSync(pre, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `${salt}:${hash}`;
}

const t1 = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('인프라팀')").run().lastInsertRowid);
const t2 = Number(db.prepare("INSERT INTO teams (team_name) VALUES ('보안팀')").run().lastInsertRowid);

db.prepare("INSERT INTO users (username,password_hash,display_name,role,team_id) VALUES (?,?,?,?,?)")
  .run("admin", hashPassword("admin123"), "총괄관리자", "admin", null);
db.prepare("INSERT INTO users (username,password_hash,display_name,role,team_id) VALUES (?,?,?,?,?)")
  .run("infra", hashPassword("infra123"), "인프라팀원", "team", t1);

db.prepare("INSERT INTO assets (asset_type,asset_name,status,team_id) VALUES ('server','infra-web-01','active',?)").run(t1);
db.prepare("INSERT INTO assets (asset_type,asset_name,status,team_id) VALUES ('security','sec-fw-01','active',?)").run(t2);
db.prepare("INSERT INTO assets (asset_type,asset_name,status,team_id) VALUES ('server','orphan-01','standby',NULL)").run();
db.prepare("INSERT INTO assets (asset_type,asset_name,status,team_id,admin_name,ip_address) VALUES ('network','orphan-sw-02','active',NULL,'미상','10.9.0.2')").run();
db.prepare("INSERT INTO assets (asset_type,asset_name,status,team_id,os) VALUES ('server','orphan-db-03','active',NULL,'RHEL8')").run();
// duplicate-name pair (동명이기/진성 중복 의심) + import_issues for dashboard cleanup cards
db.prepare("INSERT INTO assets (asset_type,asset_name,status,team_id,serial_number,ip_address) VALUES ('server','dup-host','active',?, '','')").run(t1);
const dup2 = Number(db.prepare("INSERT INTO assets (asset_type,asset_name,status,team_id,serial_number,ip_address) VALUES ('server','dup-host','active',?, '','')").run(t1).lastInsertRowid);
db.prepare("INSERT INTO import_issue (batch_id,issue_type,asset_id) VALUES ('seed','ip_format',?)").run(dup2);
db.prepare("INSERT INTO import_issue (batch_id,issue_type,asset_id) VALUES ('seed','missing_id',NULL)").run();
db.prepare("INSERT INTO import_issue (batch_id,issue_type,asset_id) VALUES ('seed','dup_suspect',?)").run(dup2);

console.log("e2e seed done");
console.log(JSON.stringify(db.prepare("SELECT username,role,team_id FROM users").all()));
console.log(JSON.stringify(db.prepare("SELECT id,team_name FROM teams").all()));
db.close();

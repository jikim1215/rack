// G010 (P9/AC-1/19/20) audit append-only + access logging + retention verification, using the REAL
// shipped libs (db.ts triggers, src/lib/retention.ts, src/lib/access-log.ts) on a real migrated DB.
//
// Run: node --experimental-strip-types scripts/verify-retention.ts
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

const results: { name: string; pass: boolean }[] = [];
const ck = (n: string, p: boolean) => results.push({ name: n, pass: p });

const dir = mkdtempSync(join(tmpdir(), "retention-"));
process.chdir(dir);
const dbmod = await import(pathToFileURL(join(process.cwd(), "src", "lib", "db.ts")).href);
const ret = await import(pathToFileURL(join(process.cwd(), "src", "lib", "retention.ts")).href);
const acc = await import(pathToFileURL(join(process.cwd(), "src", "lib", "access-log.ts")).href);
const db = dbmod.getDb() as Database.Database;

// ── access logging (AC-19) ──
acc.logAccess(db, { userId: 1, username: "admin", ip: "10.0.0.1", userAgent: "UA/1.0", action: "login", resultCode: "200" });
acc.logAccess(db, { username: "bad", ip: "10.0.0.2", userAgent: "UA/1.0", action: "fail", resultCode: "401", failureReason: "invalid_credentials" });
acc.logAccess(db, { userId: 1, username: "admin", ip: "10.0.0.1", action: "logout", resultCode: "200" });
const accRows = db.prepare("SELECT action,result_code,failure_reason,user_agent FROM access_logs ORDER BY id").all() as any[];
ck("access_logs: 3 rows (login/fail/logout)", accRows.length === 3);
ck("access_logs: enriched fields persisted", accRows[1].action === "fail" && accRows[1].result_code === "401" && accRows[1].failure_reason === "invalid_credentials" && accRows[0].user_agent === "UA/1.0");

// ── audit append-only (AC-1) ──
function insertAudit(createdAt?: string) {
  if (createdAt) {
    return db.prepare(`INSERT INTO audit_logs (entity_type,entity_id,entity_name,action,changed_by,created_at) VALUES ('asset',1,'x','create','admin',?)`).run(createdAt).lastInsertRowid;
  }
  return db.prepare(`INSERT INTO audit_logs (entity_type,entity_id,entity_name,action,changed_by) VALUES ('asset',1,'x','create','admin')`).run().lastInsertRowid;
}
const recent = Number(insertAudit());
let updateBlocked = false;
try { db.prepare("UPDATE audit_logs SET changed_by='hacker' WHERE id=?").run(recent); } catch { updateBlocked = true; }
ck("audit_logs UPDATE blocked (immutable)", updateBlocked);
let deleteRecentBlocked = false;
try { db.prepare("DELETE FROM audit_logs WHERE id=?").run(recent); } catch { deleteRecentBlocked = true; }
ck("audit_logs DELETE of recent row blocked (append-only)", deleteRecentBlocked);
ck("recent audit row still present", !!db.prepare("SELECT 1 FROM audit_logs WHERE id=?").get(recent));

// old row (2 years ago) is prunable
const oldDate = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 19).replace("T", " ");
const oldAudit = Number(insertAudit(oldDate));
let deleteOldOk = false;
try { db.prepare("DELETE FROM audit_logs WHERE id=?").run(oldAudit); deleteOldOk = true; } catch { deleteOldOk = false; }
ck("audit_logs DELETE of >1yr row allowed (retention)", deleteOldOk);

// ── retention prune (AC-20) ──
// seed old + recent rows in both tables
db.prepare(`INSERT INTO audit_logs (entity_type,entity_id,entity_name,action,changed_by,created_at) VALUES ('asset',2,'old','create','sys',?)`).run(oldDate);
db.prepare(`INSERT INTO access_logs (username,action,result_code,created_at) VALUES ('old','login','200',?)`).run(oldDate);
const auditBefore = (db.prepare("SELECT COUNT(*) c FROM audit_logs").get() as any).c;
const accessBefore = (db.prepare("SELECT COUNT(*) c FROM access_logs").get() as any).c;
const pr = ret.pruneOldLogs(db, 365);
ck("prune deleted >=1 old audit", pr.auditDeleted >= 1);
ck("prune deleted >=1 old access", pr.accessDeleted >= 1);
const auditAfter = (db.prepare("SELECT COUNT(*) c FROM audit_logs").get() as any).c;
ck("recent audit rows retained after prune", auditAfter === auditBefore - pr.auditDeleted && auditAfter >= 1);
ck("no old (>1yr) audit rows remain", (db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE created_at < datetime('now','-365 days','localtime')`).get() as any).c === 0);
ck("no old access rows remain", (db.prepare(`SELECT COUNT(*) c FROM access_logs WHERE created_at < datetime('now','-365 days','localtime')`).get() as any).c === 0);

db.close();

// ── lockfile mutual exclusion (backup vs prune) ──
const lock = join(dir, "maint.lock");
let inner = "not-run";
const outer = ret.withLock(lock, () => {
  // 동일 lock 재획득 시도 → 점유 중이므로 ran:false (상호배제)
  const nested = ret.withLock(lock, () => "should-not-run");
  inner = nested.ran ? "RAN(BAD)" : "blocked";
  return "outer-ok";
});
ck("withLock outer ran", outer.ran && outer.result === "outer-ok");
ck("withLock nested blocked while held (mutual exclusion)", inner === "blocked");
const after = ret.withLock(lock, () => "free-now");
ck("withLock acquirable again after release", after.ran && after.result === "free-now");

process.chdir(process.cwd());
rmSync(dir, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}: ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.error(`${failed.length} FAILED`); process.exit(1); }
console.log("ALL RETENTION/AUDIT/ACCESS CHECKS PASSED");

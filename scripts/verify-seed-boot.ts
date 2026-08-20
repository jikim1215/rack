// G015 회귀: `db:seed` 후 앱 부팅(initSchema)이 깨지지 않음을 보장한다.
// 원래 버그: seed의 assets는 새 status enum + 'vm' 없음 → 부팅 시 'vm' 마이그레이션 블록이
// 구 status CHECK로 assets_new를 재생성하면 INSERT...SELECT가 CHECK 위반으로 실패(배포 차단).
// 이 테스트는 실 shipped scripts/db-seed.mjs + src/lib/db.ts(getDb/initSchema)를 그대로 사용한다.
//
// Run: node --experimental-strip-types scripts/verify-seed-boot.ts
import { spawnSync } from "child_process";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.error("FAIL", m); } };

const DB_FILES = ["data.db", "data.db-wal", "data.db-shm"];
for (const f of DB_FILES) if (existsSync(f)) rmSync(f, { force: true });

// 1. 실 shipped 시드 실행
const seed = spawnSync("node", ["scripts/db-seed.mjs"], { encoding: "utf8" });
ok(seed.status === 0, `db-seed 정상 종료 (status ${seed.status})`);
ok(existsSync("data.db"), "data.db 생성됨");

// 2. 실 shipped db.ts로 부팅 (initSchema 마이그레이션). 두 번 부팅하여 멱등성 검증.
const VALID_STATUS = new Set(["active", "maintenance", "standby", "retired"]);
const { getDb } = await import(pathToFileURL(join(process.cwd(), "src", "lib", "db.ts")).href);
let db = getDb();          // 1st boot: seed DB 마이그레이션
const seeded = (db.prepare("SELECT COUNT(*) AS c FROM assets").get() as any).c;
ok(seeded > 0, `1차 부팅 후 assets 보존 (${seeded}행) — CHECK 위반 없이 마이그레이션`);

const ddl = (db.prepare("SELECT sql FROM sqlite_master WHERE name='assets'").get() as any).sql as string;
ok(/'vm'/.test(ddl), "assets.asset_type에 'vm' 추가됨");
ok(/CHECK\(status IN \('active','maintenance','standby','retired'\)\)/.test(ddl), "assets.status는 새 enum(active/maintenance/standby/retired)");

const statuses = (db.prepare("SELECT DISTINCT status FROM assets").all() as any[]).map(r => r.status);
ok(statuses.every(s => VALID_STATUS.has(s)), `모든 status 값이 유효 enum (${JSON.stringify(statuses)})`);

const cols = (db.prepare("PRAGMA table_info(assets)").all() as any[]).map(c => c.name);
ok(["team_id", "network_zone", "cia_c", "cia_i", "cia_a"].every(c => cols.includes(c)), "P1 컬럼(team_id/network_zone/cia_*) 존재");

const tbls = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(t => t.name));
ok(["teams", "users", "import_issue", "access_logs", "audit_logs"].every(t => tbls.has(t)), "P1 테이블(teams/users/import_issue/access_logs/audit_logs) 존재");

const views = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='view'").all() as any[]).map(v => v.name));
ok(views.has("v_cleanup_queue"), "v_cleanup_queue 뷰 존재");
const cq = (db.prepare("SELECT COUNT(*) AS c FROM v_cleanup_queue").get() as any).c;
ok(typeof cq === "number", `v_cleanup_queue 조회 가능 (${cq}행)`);

// 3. 멱등성: 동일 프로세스 재호출 + 마이그레이션 재진입은 단순 no-op
db = getDb();
const again = (db.prepare("SELECT COUNT(*) AS c FROM assets").get() as any).c;
ok(again === seeded, `2차 부팅 멱등 (assets ${again} === ${seeded})`);

db.close();
for (const f of DB_FILES) { if (existsSync(f)) { try { rmSync(f, { force: true }); } catch { /* WAL 잠금 무시 */ } } }

console.log(`\n--- verify-seed-boot pass=${pass} fail=${fail} ---`);
if (fail) { console.error("SEED→BOOT REGRESSION FAILED"); process.exit(1); }
console.log("ALL SEED→BOOT CHECKS PASSED (real db-seed + real db.ts initSchema)");

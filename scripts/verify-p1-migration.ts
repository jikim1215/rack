// G002 (P1) schema-migration verification harness.
// Drives the REAL src/lib/db.ts against fresh and legacy-shaped DBs, each in its
// own child process (fresh module + fresh better-sqlite3 handle), then asserts
// the resulting schema, value mappings, idempotency, and CHECK enforcement.
//
// Run: node --experimental-strip-types scripts/verify-p1-migration.ts
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL, fileURLToPath } from "url";
import { spawnSync } from "child_process";

const DB_TS = join(process.cwd(), "src", "lib", "db.ts");

// ── child worker: open the real db module in `dir`, emit schema introspection ──
async function childInspect(dir: string) {
  process.chdir(dir);
  const mod = await import(pathToFileURL(DB_TS).href);
  const db = mod.getDb() as Database.Database;
  const ddl = (n: string) =>
    ((db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(n) as any)?.sql ?? "");
  const exists = (type: string, n: string) =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type=? AND name=?").get(type, n);
  const cols = (t: string) =>
    (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name);
  // adversarial write probes
  const probe = (sql: string): { ok: boolean } => {
    try { db.prepare(sql).run(); return { ok: true }; } catch { return { ok: false }; }
  };
  const out = {
    ddl: {
      users: ddl("users"), assets: ddl("assets"), asset_ips: ddl("asset_ips"),
      menu_permissions: ddl("menu_permissions"),
    },
    cols: {
      users: cols("users"), assets: cols("assets"), access_logs: cols("access_logs"),
    },
    exists: {
      teams: exists("table", "teams"), import_issue: exists("table", "import_issue"),
      access_logs: exists("table", "access_logs"), audit_logs: exists("table", "audit_logs"),
      v_cleanup_queue: exists("view", "v_cleanup_queue"),
      idx_assets_team: exists("index", "idx_assets_team"),
      idx_access_logs_created: exists("index", "idx_access_logs_created"),
      idx_import_issue_batch: exists("index", "idx_import_issue_batch"),
      assets_new_leftover: exists("table", "assets_new"),
      users_new_leftover: exists("table", "users_new"),
    },
    data: {
      users: db.prepare("SELECT username,role FROM users ORDER BY id").all(),
      assets: db.prepare("SELECT asset_name,status FROM assets ORDER BY id").all(),
      asset_ip_count: (db.prepare("SELECT COUNT(*) n FROM asset_ips").get() as any).n,
      menu_roles: (db.prepare("SELECT DISTINCT role FROM menu_permissions").all() as any[]).map((r) => r.role),
    },
    probes: {
      viewQueryable: (() => { try { db.prepare("SELECT * FROM v_cleanup_queue LIMIT 1").all(); return true; } catch { return false; } })(),
      insertExtraIp: probe("INSERT INTO asset_ips (asset_id,ip_address,ip_type) VALUES (1,'10.0.0.250','extra')").ok,
      rejectLegacyStatus: !probe("INSERT INTO assets (asset_type,asset_name,status) VALUES ('server','__bad__','inactive')").ok,
      rejectLegacyRole: !probe("INSERT INTO users (username,password_hash,role) VALUES ('__bad__','x','user')").ok,
    },
  };
  process.stdout.write("__JSON__" + JSON.stringify(out) + "__JSON__");
  db.close();
}

function runChild(dir: string): any {
  const selfPath = fileURLToPath(import.meta.url);
  const r = spawnSync(process.execPath, ["--experimental-strip-types", selfPath, "child", dir],
    { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`child failed (dir=${dir}):\n${r.stdout}\n${r.stderr}`);
  }
  const m = /__JSON__([\s\S]*)__JSON__/.exec(r.stdout);
  if (!m) throw new Error(`child produced no JSON (dir=${dir}):\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(m[1]);
}

function seedLegacy(dir: string) {
  const seed = new Database(join(dir, "data.db"));
  seed.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, display_name TEXT DEFAULT '', role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user','viewer')), is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE locations (id INTEGER PRIMARY KEY AUTOINCREMENT, location_name TEXT NOT NULL, building TEXT DEFAULT '', floor TEXT DEFAULT '', room TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE racks (id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE, rack_name TEXT NOT NULL, total_units INTEGER NOT NULL DEFAULT 42, description TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE assets (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_type TEXT NOT NULL CHECK(asset_type IN ('server','network','security','telecom','vm','other')), asset_name TEXT NOT NULL, manufacturer TEXT DEFAULT '', model TEXT DEFAULT '', serial_number TEXT DEFAULT '', ip_address TEXT DEFAULT '', asset_tag TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','maintenance','decommissioned','eos')), network_zone TEXT DEFAULT '' CHECK(network_zone IN ('','업무망','인터넷망')), purchase_date TEXT DEFAULT '', warranty_date TEXT DEFAULT '', eos_date TEXT DEFAULT '', description TEXT DEFAULT '', os TEXT DEFAULT '', access_ip TEXT DEFAULT '', user_name TEXT DEFAULT '', admin_name TEXT DEFAULT '', department TEXT DEFAULT '', cia_c INTEGER, cia_i INTEGER, cia_a INTEGER, rack_id INTEGER REFERENCES racks(id) ON DELETE SET NULL, rack_unit_start INTEGER, rack_unit_size INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE asset_ips (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE, ip_address TEXT NOT NULL, ip_type TEXT DEFAULT 'service' CHECK(ip_type IN ('management','service','backup','vip','other')), interface_name TEXT DEFAULT '', subnet_mask TEXT DEFAULT '', gateway TEXT DEFAULT '', is_primary INTEGER DEFAULT 0, description TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE menu_permissions (id INTEGER PRIMARY KEY AUTOINCREMENT, menu_key TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user','viewer')), can_access INTEGER DEFAULT 1, can_write INTEGER DEFAULT 0, can_approve INTEGER DEFAULT 0, UNIQUE(menu_key, role));
    INSERT INTO users (username,password_hash,role) VALUES ('admin','x','admin'),('alice','x','user'),('bob','x','viewer');
    INSERT INTO locations (location_name) VALUES ('DC1');
    INSERT INTO assets (asset_type,asset_name,status) VALUES ('server','s-active','active'),('server','s-inactive','inactive'),('server','s-decom','decommissioned'),('server','s-eos','eos');
    INSERT INTO asset_ips (asset_id,ip_address,ip_type) VALUES (1,'10.0.0.1','service'),(1,'10.0.0.2','vip');
    INSERT INTO menu_permissions (menu_key,role,can_access) VALUES ('assets','user',1),('assets','admin',1);
  `);
  seed.close();
}

function seedPreVm(dir: string) {
  // Genuinely pre-'vm' rack-era schema: asset_type CHECK without 'vm', status legacy enum,
  // NO network_zone / cia_* columns. Exercises the double-recreate path (vm block -> standby block).
  const seed = new Database(join(dir, "data.db"));
  seed.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, display_name TEXT DEFAULT '', role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user','viewer')), is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE locations (id INTEGER PRIMARY KEY AUTOINCREMENT, location_name TEXT NOT NULL, building TEXT DEFAULT '', floor TEXT DEFAULT '', room TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE racks (id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE, rack_name TEXT NOT NULL, total_units INTEGER NOT NULL DEFAULT 42, description TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE assets (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_type TEXT NOT NULL CHECK(asset_type IN ('server','network','security','telecom','other')), asset_name TEXT NOT NULL, manufacturer TEXT DEFAULT '', model TEXT DEFAULT '', serial_number TEXT DEFAULT '', ip_address TEXT DEFAULT '', asset_tag TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','maintenance','decommissioned','eos')), purchase_date TEXT DEFAULT '', warranty_date TEXT DEFAULT '', eos_date TEXT DEFAULT '', description TEXT DEFAULT '', os TEXT DEFAULT '', access_ip TEXT DEFAULT '', user_name TEXT DEFAULT '', admin_name TEXT DEFAULT '', department TEXT DEFAULT '', rack_id INTEGER REFERENCES racks(id) ON DELETE SET NULL, rack_unit_start INTEGER, rack_unit_size INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE asset_ips (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE, ip_address TEXT NOT NULL, ip_type TEXT DEFAULT 'service' CHECK(ip_type IN ('management','service','backup','vip','other')), interface_name TEXT DEFAULT '', subnet_mask TEXT DEFAULT '', gateway TEXT DEFAULT '', is_primary INTEGER DEFAULT 0, description TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')));
    INSERT INTO users (username,password_hash,role) VALUES ('carol','x','user');
    INSERT INTO locations (location_name) VALUES ('DC2');
    INSERT INTO assets (asset_type,asset_name,status,os,admin_name,department) VALUES
      ('server','pv-active','active','RHEL8','kim','infra'),
      ('network','pv-decom','decommissioned','','lee','net'),
      ('security','pv-eos','eos','','park','sec');
    INSERT INTO asset_ips (asset_id,ip_address,ip_type) VALUES (1,'172.16.0.1','service');
  `);
  seed.close();
}

async function orchestrate() {
  const results: { name: string; pass: boolean }[] = [];
  const ck = (name: string, pass: boolean) => results.push({ name, pass });

  // Scenario A: fresh DB
  const dirA = mkdtempSync(join(tmpdir(), "p1-fresh-"));
  const A = runChild(dirA);
  ck("A: teams table exists", A.exists.teams);
  ck("A: import_issue exists", A.exists.import_issue);
  ck("A: access_logs exists", A.exists.access_logs);
  ck("A: access_logs has user_agent/result_code/failure_reason",
    ["user_agent", "result_code", "failure_reason"].every((c) => A.cols.access_logs.includes(c)));
  ck("A: users.team_id column", A.cols.users.includes("team_id"));
  ck("A: users role CHECK admin/team/viewer", /role IN \('admin','team','viewer'\)/.test(A.ddl.users));
  ck("A: users role CHECK drops legacy 'user'", !/'user'/.test(A.ddl.users));
  ck("A: assets.team_id column", A.cols.assets.includes("team_id"));
  ck("A: assets.department retained (legacy shadow)", A.cols.assets.includes("department"));
  ck("A: assets status enum active/maintenance/standby/retired",
    /status IN \('active','maintenance','standby','retired'\)/.test(A.ddl.assets));
  ck("A: asset_ips ip_type includes 'extra'", /'extra'/.test(A.ddl.asset_ips));
  ck("A: audit_logs exists", A.exists.audit_logs);
  ck("A: v_cleanup_queue view exists", A.exists.v_cleanup_queue);
  ck("A: v_cleanup_queue queryable", A.probes.viewQueryable);
  ck("A: idx_assets_team exists", A.exists.idx_assets_team);
  ck("A: idx_access_logs_created exists", A.exists.idx_access_logs_created);
  ck("A: idx_import_issue_batch exists", A.exists.idx_import_issue_batch);
  rmSync(dirA, { recursive: true, force: true });

  // Scenario B: legacy-shaped DB → migrate
  const dirB = mkdtempSync(join(tmpdir(), "p1-legacy-"));
  seedLegacy(dirB);
  const B = runChild(dirB);
  const roleOf = (u: string) => B.data.users.find((r: any) => r.username === u)?.role;
  ck("B: alice role user->team", roleOf("alice") === "team");
  ck("B: admin role unchanged", roleOf("admin") === "admin");
  ck("B: bob viewer unchanged", roleOf("bob") === "viewer");
  ck("B: users.team_id added", B.cols.users.includes("team_id"));
  const sm: Record<string, string> = Object.fromEntries(B.data.assets.map((r: any) => [r.asset_name, r.status]));
  ck("B: status active stays active", sm["s-active"] === "active");
  ck("B: status inactive->standby", sm["s-inactive"] === "standby");
  ck("B: status decommissioned->retired", sm["s-decom"] === "retired");
  ck("B: status eos->retired", sm["s-eos"] === "retired");
  ck("B: assets row count preserved (4)", B.data.assets.length === 4);
  ck("B: assets.team_id added", B.cols.assets.includes("team_id"));
  ck("B: asset_ips rows preserved (>=2)", B.data.asset_ip_count >= 2);
  ck("B: can insert ip_type='extra'", B.probes.insertExtraIp);
  ck("B: menu_permissions user->team", B.data.menu_roles.includes("team") && !B.data.menu_roles.includes("user"));
  ck("B: legacy status 'inactive' rejected by CHECK", B.probes.rejectLegacyStatus);
  ck("B: legacy role 'user' rejected by CHECK", B.probes.rejectLegacyRole);
  rmSync(dirB, { recursive: true, force: true });

  // Scenario C: idempotency — run migration twice on the same dir
  const dirC = mkdtempSync(join(tmpdir(), "p1-idem-"));
  const C1 = runChild(dirC); // creates + migrates
  const C2 = runChild(dirC); // re-runs initSchema on already-migrated DB
  ck("C: users DDL stable across re-run", C1.ddl.users === C2.ddl.users && /'team'/.test(C2.ddl.users));
  ck("C: assets DDL stable across re-run", C1.ddl.assets === C2.ddl.assets && /'standby'/.test(C2.ddl.assets));
  ck("C: asset_ips DDL stable across re-run", C1.ddl.asset_ips === C2.ddl.asset_ips);
  ck("C: no assets_new/users_new leftover", !C2.exists.assets_new_leftover && !C2.exists.users_new_leftover);
  rmSync(dirC, { recursive: true, force: true });

  // Scenario D: genuinely pre-'vm' DB → double recreate (vm block then standby block)
  const dirD = mkdtempSync(join(tmpdir(), "p1-prevm-"));
  seedPreVm(dirD);
  const D = runChild(dirD);
  const dsm: Record<string, string> = Object.fromEntries(D.data.assets.map((r: any) => [r.asset_name, r.status]));
  ck("D: pre-vm row count preserved (3)", D.data.assets.length === 3);
  ck("D: pre-vm active stays active", dsm["pv-active"] === "active");
  ck("D: pre-vm decommissioned->retired", dsm["pv-decom"] === "retired");
  ck("D: pre-vm eos->retired", dsm["pv-eos"] === "retired");
  ck("D: pre-vm asset_type now allows 'vm'", /'vm'/.test(D.ddl.assets));
  ck("D: pre-vm status enum upgraded to standby/retired", /status IN \('active','maintenance','standby','retired'\)/.test(D.ddl.assets));
  ck("D: pre-vm assets.team_id materialized", D.cols.assets.includes("team_id"));
  ck("D: pre-vm network_zone column materialized (default)", D.cols.assets.includes("network_zone"));
  ck("D: pre-vm department shadow retained", D.cols.assets.includes("department"));
  ck("D: pre-vm carol role user->team", D.data.users.find((r: any) => r.username === "carol")?.role === "team");
  ck("D: pre-vm asset_ips preserved (>=1)", D.data.asset_ip_count >= 1);
  ck("D: pre-vm no assets_new/users_new leftover", !D.exists.assets_new_leftover && !D.exists.users_new_leftover);
  rmSync(dirD, { recursive: true, force: true });

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}: ${r.name}`);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.error(`${failed.length} FAILED`); process.exit(1); }
  console.log("ALL P1 MIGRATION CHECKS PASSED");
}

if (process.argv[2] === "child") {
  await childInspect(process.argv[3]);
} else {
  await orchestrate();
}

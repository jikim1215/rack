// tests/asset-type-zone-freeform.test.ts — asset_type / network_zone 고정 enum(CHECK) 해제 검증 (ADR-011 확장)
// 시나리오: "구버전 스키마(CHECK 있음)"로 만든 DB를 getDb()가 열 때 1회 재빌드로 CHECK를 제거하고,
//           독립 부서가 자기 유형·망구분을 자유 입력할 수 있는지(기존 데이터·생성컬럼 보존 포함) 확인.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const dir = mkdtempSync(join(tmpdir(), "asset-freeform-"));
const DB = join(dir, "test.db");

// 1) getDb 호출 전에 "구버전" assets 테이블(두 CHECK 포함)을 직접 만들어 둔다.
//    initSchema는 CREATE TABLE IF NOT EXISTS 라 이 테이블을 보존하고, 이후 마이그레이션이 CHECK를 제거한다.
before(() => {
  const raw = new Database(DB);
  raw.pragma("journal_mode = WAL");
  raw.exec(`
    CREATE TABLE teams (id INTEGER PRIMARY KEY AUTOINCREMENT, team_name TEXT NOT NULL UNIQUE, created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE racks (id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER, rack_name TEXT NOT NULL, total_units INTEGER NOT NULL DEFAULT 42, description TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_type TEXT NOT NULL CHECK(asset_type IN ('server','network','security','telecom','vm','other')),
      asset_name TEXT NOT NULL,
      manufacturer TEXT DEFAULT '', model TEXT DEFAULT '', serial_number TEXT DEFAULT '',
      ip_address TEXT DEFAULT '', asset_tag TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','maintenance','standby','retired')),
      network_zone TEXT DEFAULT '' CHECK(network_zone IN ('','업무망','인터넷망')),
      purchase_date TEXT DEFAULT '', warranty_date TEXT DEFAULT '', eos_date TEXT DEFAULT '',
      description TEXT DEFAULT '', os TEXT DEFAULT '', access_ip TEXT DEFAULT '',
      user_name TEXT DEFAULT '', admin_name TEXT DEFAULT '', department TEXT DEFAULT '',
      team_id INTEGER REFERENCES teams(id),
      cia_c INTEGER, cia_i INTEGER, cia_a INTEGER, import_batch_id TEXT,
      cia_total INTEGER GENERATED ALWAYS AS (CASE WHEN cia_c IS NULL OR cia_i IS NULL OR cia_a IS NULL THEN NULL ELSE cia_c+cia_i+cia_a END) VIRTUAL,
      cia_grade TEXT GENERATED ALWAYS AS (CASE WHEN cia_c IS NULL OR cia_i IS NULL OR cia_a IS NULL THEN '' WHEN cia_c+cia_i+cia_a>=7 THEN 'H' WHEN cia_c+cia_i+cia_a>=5 THEN 'M' ELSE 'L' END) VIRTUAL,
      rack_id INTEGER REFERENCES racks(id) ON DELETE SET NULL,
      rack_unit_start INTEGER, rack_unit_size INTEGER DEFAULT 1,
      rack_side TEXT CHECK(rack_side IN ('L','R')),
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);
  // 구버전 표준 자산 1건 + CIA로 생성컬럼 검증
  raw.prepare("INSERT INTO assets (asset_type, asset_name, network_zone, cia_c, cia_i, cia_a) VALUES ('server','LEGACY-SRV','업무망',3,3,3)").run();
  // 구버전 스키마는 CHECK가 살아있어 커스텀 유형이 거부되어야 정상(사전 조건 확인)
  assert.throws(() => raw.prepare("INSERT INTO assets (asset_type, asset_name) VALUES ('스토리지','X')").run(), /CHECK/);
  raw.close();
});

after(async () => {
  try { const { getDb } = await import("../src/lib/db.ts"); getDb().close(); } catch { /* noop */ }
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); } catch { /* Windows WAL 잠금 잔여 — 임시파일이라 무시 */ }
});

test("getDb 오픈 시 마이그레이션: assets DDL에서 asset_type/network_zone CHECK가 제거된다", async () => {
  process.env.ASSET_DB_PATH = DB;
  const { getDb } = await import("../src/lib/db.ts");
  const db = getDb();
  const ddl = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='assets'").get() as any).sql as string;
  assert.ok(!/CHECK\s*\(\s*asset_type\s+IN/i.test(ddl), "asset_type CHECK가 남아 있음");
  assert.ok(!/CHECK\s*\(\s*network_zone\s+IN/i.test(ddl), "network_zone CHECK가 남아 있음");
  // status / rack_side CHECK는 유지되어야 한다(운영 enum)
  assert.ok(/CHECK\s*\(\s*status\s+IN/i.test(ddl), "status CHECK가 사라짐(유지되어야 함)");
});

test("기존 데이터 + 생성컬럼(cia_grade) 보존", async () => {
  const { getDb } = await import("../src/lib/db.ts");
  const db = getDb();
  const row = db.prepare("SELECT asset_name, asset_type, network_zone, cia_grade FROM assets WHERE asset_name='LEGACY-SRV'").get() as any;
  assert.equal(row.asset_type, "server");
  assert.equal(row.network_zone, "업무망");
  assert.equal(row.cia_grade, "H"); // 3+3+3=9 → H (생성컬럼 재계산 정상)
});

test("독립 부서 자유 입력: 커스텀 유형·망구분 저장 가능(CHECK 해제 후)", async () => {
  const { getDb } = await import("../src/lib/db.ts");
  const db = getDb();
  assert.doesNotThrow(() => {
    db.prepare("INSERT INTO assets (asset_type, asset_name, network_zone) VALUES ('스토리지','CUSTOM-1','외부IDC망')").run();
    db.prepare("INSERT INTO assets (asset_type, asset_name, network_zone) VALUES ('백업장비','CUSTOM-2','관리망')").run();
  });
  const got = db.prepare("SELECT asset_type, network_zone FROM assets WHERE asset_name='CUSTOM-1'").get() as any;
  assert.equal(got.asset_type, "스토리지");
  assert.equal(got.network_zone, "외부IDC망");
});

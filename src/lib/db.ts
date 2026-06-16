import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    -- 위치(건물/층/서버실)
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      building TEXT DEFAULT '',
      floor TEXT DEFAULT '',
      room TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 랙
    CREATE TABLE IF NOT EXISTS racks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      total_units INTEGER NOT NULL DEFAULT 42,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 자산 유형: server, network, security, storage, etc.
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_type TEXT NOT NULL CHECK(asset_type IN ('server','network','security','storage','other')),
      name TEXT NOT NULL,
      manufacturer TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      asset_tag TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','maintenance','decommissioned')),
      purchase_date TEXT DEFAULT '',
      warranty_date TEXT DEFAULT '',
      description TEXT DEFAULT '',
      rack_id INTEGER REFERENCES racks(id) ON DELETE SET NULL,
      rack_unit_start INTEGER,
      rack_unit_size INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 네트워크 장비 포트
    CREATE TABLE IF NOT EXISTS ports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      port_number INTEGER NOT NULL,
      port_name TEXT DEFAULT '',
      port_type TEXT DEFAULT 'ethernet' CHECK(port_type IN ('ethernet','fiber','console','management','sfp','sfp_plus','qsfp')),
      speed TEXT DEFAULT '',
      connected_to_port_id INTEGER REFERENCES ports(id) ON DELETE SET NULL,
      vlan TEXT DEFAULT '',
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'unused' CHECK(status IN ('used','unused','reserved','disabled'))
    );

    -- 인덱스
    CREATE INDEX IF NOT EXISTS idx_assets_rack ON assets(rack_id);
    CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);
    CREATE INDEX IF NOT EXISTS idx_ports_asset ON ports(asset_id);
    CREATE INDEX IF NOT EXISTS idx_ports_connected ON ports(connected_to_port_id);
  `);
}

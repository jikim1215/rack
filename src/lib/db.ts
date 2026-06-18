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
    -- 사용자
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user','viewer')),
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 위치
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_name TEXT NOT NULL,
      building TEXT DEFAULT '',
      floor TEXT DEFAULT '',
      room TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 랙
    CREATE TABLE IF NOT EXISTS racks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      rack_name TEXT NOT NULL,
      total_units INTEGER NOT NULL DEFAULT 42,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 자산
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_type TEXT NOT NULL CHECK(asset_type IN ('server','network','security','telecom','other')),
      asset_name TEXT NOT NULL,
      manufacturer TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      asset_tag TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive','maintenance','decommissioned','eos')),
      purchase_date TEXT DEFAULT '',
      warranty_date TEXT DEFAULT '',
      eos_date TEXT DEFAULT '',
      description TEXT DEFAULT '',
      os TEXT DEFAULT '',
      access_ip TEXT DEFAULT '',
      user_name TEXT DEFAULT '',
      admin_name TEXT DEFAULT '',
      department TEXT DEFAULT '',
      rack_id INTEGER REFERENCES racks(id) ON DELETE SET NULL,
      rack_unit_start INTEGER,
      rack_unit_size INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 자산별 다중 IP
    CREATE TABLE IF NOT EXISTS asset_ips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      ip_address TEXT NOT NULL,
      ip_type TEXT DEFAULT 'service' CHECK(ip_type IN ('management','service','backup','vip','other')),
      interface_name TEXT DEFAULT '',
      subnet_mask TEXT DEFAULT '',
      gateway TEXT DEFAULT '',
      is_primary INTEGER DEFAULT 0,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 자산 변경 이력
    CREATE TABLE IF NOT EXISTS asset_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER,
      asset_name TEXT DEFAULT '',
      action TEXT NOT NULL CHECK(action IN ('create','update','delete')),
      changed_by TEXT DEFAULT '',
      changed_fields TEXT DEFAULT '[]',
      old_values TEXT DEFAULT '{}',
      new_values TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 커스텀 필드 정의
    CREATE TABLE IF NOT EXISTS custom_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_key TEXT NOT NULL UNIQUE,
      field_label TEXT NOT NULL,
      field_type TEXT NOT NULL DEFAULT 'text' CHECK(field_type IN ('text','number','date','select','textarea','multi-text')),
      field_group TEXT DEFAULT '기본',
      options TEXT DEFAULT '',
      asset_types TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      is_required INTEGER DEFAULT 0,
      show_in_table INTEGER DEFAULT 0,
      show_in_detail INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 커스텀 필드 값
    CREATE TABLE IF NOT EXISTS custom_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
      value TEXT DEFAULT '',
      UNIQUE(asset_id, field_id)
    );

    -- 배선반 (MDF/TPS 110블록 등)
    CREATE TABLE IF NOT EXISTS dist_frames (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      rack_id INTEGER REFERENCES racks(id) ON DELETE SET NULL,
      frame_name TEXT NOT NULL,
      frame_type TEXT NOT NULL DEFAULT '110block' CHECK(frame_type IN ('110block','patch_panel','optical','other')),
      total_pairs INTEGER NOT NULL DEFAULT 50,
      rack_unit_start INTEGER,
      rack_unit_size INTEGER DEFAULT 2,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 배선반 페어
    CREATE TABLE IF NOT EXISTS frame_pairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      frame_id INTEGER NOT NULL REFERENCES dist_frames(id) ON DELETE CASCADE,
      pair_number INTEGER NOT NULL,
      status TEXT DEFAULT 'unused' CHECK(status IN ('used','unused','reserved','faulty')),
      label TEXT DEFAULT '',
      source TEXT DEFAULT '',
      destination TEXT DEFAULT '',
      cable_id TEXT DEFAULT '',
      user_info TEXT DEFAULT '',
      description TEXT DEFAULT '',
      UNIQUE(frame_id, pair_number)
    );

    -- 네트워크 포트
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

    -- 업체
    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_name TEXT NOT NULL,
      contact_person TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      business_number TEXT DEFAULT '',
      vendor_type TEXT DEFAULT 'maintenance' CHECK(vendor_type IN ('maintenance','supplier','other')),
      is_active INTEGER DEFAULT 1,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 계약
    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
      contract_name TEXT NOT NULL,
      contract_type TEXT DEFAULT 'maintenance' CHECK(contract_type IN ('maintenance','purchase','lease','other')),
      start_date TEXT DEFAULT '',
      end_date TEXT DEFAULT '',
      amount TEXT DEFAULT '',
      auto_renew INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','expired','cancelled')),
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 반입/반출
    CREATE TABLE IF NOT EXISTS asset_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
      movement_type TEXT NOT NULL CHECK(movement_type IN ('bring_in','bring_out','return')),
      movement_date TEXT DEFAULT '',
      requester TEXT DEFAULT '',
      approver TEXT DEFAULT '',
      department TEXT DEFAULT '',
      purpose TEXT DEFAULT '',
      destination TEXT DEFAULT '',
      equipment_desc TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      status TEXT DEFAULT 'requested' CHECK(status IN ('requested','approved','completed','rejected')),
      notes TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 유지보수/장애
    CREATE TABLE IF NOT EXISTS maintenance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      log_type TEXT DEFAULT 'failure' CHECK(log_type IN ('failure','maintenance','inspection')),
      occurred_at TEXT DEFAULT '',
      resolved_at TEXT DEFAULT '',
      reported_by TEXT DEFAULT '',
      handled_by TEXT DEFAULT '',
      severity TEXT DEFAULT 'minor' CHECK(severity IN ('critical','major','minor')),
      symptom TEXT DEFAULT '',
      action_taken TEXT DEFAULT '',
      vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
      cost TEXT DEFAULT '',
      status TEXT DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')),
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- IP 대역
    CREATE TABLE IF NOT EXISTS ip_subnets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subnet_name TEXT NOT NULL,
      network_address TEXT NOT NULL,
      subnet_mask TEXT DEFAULT '255.255.255.0',
      gateway TEXT DEFAULT '',
      vlan_id TEXT DEFAULT '',
      location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 인덱스
    CREATE INDEX IF NOT EXISTS idx_assets_rack ON assets(rack_id);
    CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);
    CREATE INDEX IF NOT EXISTS idx_asset_ips_asset ON asset_ips(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_logs_asset ON asset_logs(asset_id);
    CREATE INDEX IF NOT EXISTS idx_ports_asset ON ports(asset_id);
    CREATE INDEX IF NOT EXISTS idx_ports_connected ON ports(connected_to_port_id);
    CREATE INDEX IF NOT EXISTS idx_custom_values_asset ON custom_values(asset_id);
    CREATE INDEX IF NOT EXISTS idx_custom_values_field ON custom_values(field_id);
    CREATE INDEX IF NOT EXISTS idx_dist_frames_location ON dist_frames(location_id);
    CREATE INDEX IF NOT EXISTS idx_frame_pairs_frame ON frame_pairs(frame_id);
    CREATE INDEX IF NOT EXISTS idx_movements_asset ON asset_movements(asset_id);
    CREATE INDEX IF NOT EXISTS idx_maintenance_asset ON maintenance_logs(asset_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_vendor ON contracts(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_subnets_location ON ip_subnets(location_id);
  `);

  // 기존 DB 마이그레이션
  const cols = db.prepare("PRAGMA table_info(assets)").all() as any[];
  const colNames = new Set(cols.map((c: any) => c.name));
  for (const [name, def] of [
    ["os", "TEXT DEFAULT ''"], ["access_ip", "TEXT DEFAULT ''"],
    ["user_name", "TEXT DEFAULT ''"], ["admin_name", "TEXT DEFAULT ''"],
    ["department", "TEXT DEFAULT ''"], ["eos_date", "TEXT DEFAULT ''"],
  ]) {
    if (!colNames.has(name)) {
      db.exec(`ALTER TABLE assets ADD COLUMN ${name} ${def}`);
    }
  }

  // custom_fields 마이그레이션
  const cfCols = db.prepare("PRAGMA table_info(custom_fields)").all() as any[];
  const cfColNames = new Set(cfCols.map((c: any) => c.name));
  for (const [name, def] of [
    ["field_group", "TEXT DEFAULT '기본'"],
    ["is_required", "INTEGER DEFAULT 0"],
    ["show_in_table", "INTEGER DEFAULT 0"],
    ["show_in_detail", "INTEGER DEFAULT 1"],
  ]) {
    if (!cfColNames.has(name)) {
      db.exec(`ALTER TABLE custom_fields ADD COLUMN ${name} ${def}`);
    }
  }
}

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { scryptSync, randomBytes, createHash } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "data.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function sha512(str) { return createHash('sha512').update(str).digest('hex'); }
function hashPw(pw) {
  const hashed = sha512(pw);
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(hashed, salt, 64).toString("hex");
}

// ============================================================
// 스키마 생성
// ============================================================
db.exec(`
  DROP TABLE IF EXISTS menu_permissions;
  DROP TABLE IF EXISTS contract_assets;
  DROP TABLE IF EXISTS maintenance_logs;
  DROP TABLE IF EXISTS asset_movements;
  DROP TABLE IF EXISTS contracts;
  DROP TABLE IF EXISTS vendors;
  DROP TABLE IF EXISTS ip_subnets;
  DROP TABLE IF EXISTS frame_pairs;
  DROP TABLE IF EXISTS dist_frames;
  DROP TABLE IF EXISTS custom_values;
  DROP TABLE IF EXISTS custom_fields;
  DROP TABLE IF EXISTS asset_logs;
  DROP TABLE IF EXISTS asset_ips;
  DROP TABLE IF EXISTS ports;
  DROP TABLE IF EXISTS assets;
  DROP TABLE IF EXISTS racks;
  DROP TABLE IF EXISTS locations;
  DROP TABLE IF EXISTS users;
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user','viewer')),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_name TEXT NOT NULL,

    building TEXT DEFAULT '',
    floor TEXT DEFAULT '',
    room TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS racks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    rack_name TEXT NOT NULL,

    total_units INTEGER NOT NULL DEFAULT 42,
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

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

  CREATE TABLE IF NOT EXISTS custom_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    value TEXT DEFAULT '',
    UNIQUE(asset_id, field_id)
  );

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
  CREATE TABLE IF NOT EXISTS contract_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    UNIQUE(contract_id, asset_id)
  );
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
  CREATE TABLE IF NOT EXISTS menu_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_key TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','user','viewer')),
    can_access INTEGER DEFAULT 1,
    can_write INTEGER DEFAULT 0,
    can_approve INTEGER DEFAULT 0,
    UNIQUE(menu_key, role)
  );

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
  CREATE INDEX IF NOT EXISTS idx_menu_perms ON menu_permissions(role, menu_key);
`);

// ============================================================
// 기존 데이터 삭제
// ============================================================
db.exec(`
  DELETE FROM frame_pairs;
  DELETE FROM dist_frames;
  DELETE FROM custom_values;
  DELETE FROM custom_fields;
  DELETE FROM ports;
  DELETE FROM asset_ips;
  DELETE FROM asset_logs;
  DELETE FROM assets;
  DELETE FROM racks;
  DELETE FROM locations;
  DELETE FROM users;
`);

// ============================================================
// users (3명)
// ============================================================
const insertUser = db.prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES (?,?,?,?)");
insertUser.run("admin", hashPw("admin123"), "시스템관리자", "admin");
insertUser.run("user", hashPw("user123"), "일반사용자", "user");
insertUser.run("viewer", hashPw("viewer123"), "열람자", "viewer");

// ============================================================
// locations + racks
// ============================================================
const insertLocation = db.prepare("INSERT INTO locations (location_name, building, floor, room) VALUES (?,?,?,?)");

const loc1 = insertLocation.run("본관 전산실", "본관", "B1", "전산실A").lastInsertRowid;
const loc2 = insertLocation.run("별관 서버실", "별관", "3F", "서버실B").lastInsertRowid;
const locMdf = insertLocation.run("본원 MDF실", "본원", "B1", "MDF실").lastInsertRowid;

const insertRack = db.prepare("INSERT INTO racks (location_id, rack_name, total_units, description) VALUES (?,?,?,?)");

const rack1 = insertRack.run(loc1, "A-01", 42, "메인 서버랙").lastInsertRowid;
const rack2 = insertRack.run(loc1, "A-02", 42, "네트워크 장비랙").lastInsertRowid;
const rack3 = insertRack.run(loc1, "A-03", 42, "보안 장비랙").lastInsertRowid;
const rack4 = insertRack.run(loc2, "B-01", 24, "별관 서버랙").lastInsertRowid;
const rackMdf = insertRack.run(locMdf, "M-01", 42, "MDF 메인랙").lastInsertRowid;

// ============================================================
// assets (14대 기존)
// ============================================================
const insertAsset = db.prepare(`INSERT INTO assets
  (asset_type, asset_name, manufacturer, model, serial_number, ip_address, asset_tag, status,

   os, access_ip, user_name, admin_name, department,
   purchase_date, warranty_date, eos_date,
   rack_id, rack_unit_start, rack_unit_size, description)
  VALUES (?,?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?,?)`);

// 서버
const srv1 = insertAsset.run("server", "웹서버-01", "Dell", "PowerEdge R740", "SRV-2024-001", "10.10.1.11", "SV-001", "active",
  "Rocky Linux 8.9", "10.10.1.11", "", "김정보", "정보운영과",
  "2022-03-15", "2027-03-14", "2029-12-31",
  rack1, 1, 2, "메인 웹서버").lastInsertRowid;
const srv2 = insertAsset.run("server", "웹서버-02", "Dell", "PowerEdge R740", "SRV-2024-002", "10.10.1.12", "SV-002", "active",
  "Rocky Linux 8.9", "10.10.1.12", "", "김정보", "정보운영과",
  "2022-03-15", "2027-03-14", "2029-12-31",
  rack1, 3, 2, "보조 웹서버").lastInsertRowid;
const srv3 = insertAsset.run("server", "DB서버-01", "HP", "ProLiant DL380 Gen10", "SRV-2024-003", "10.10.1.21", "SV-003", "active",
  "Oracle Linux 8.8", "10.10.1.21", "", "박데이터", "정보운영과",
  "2021-06-01", "2026-05-31", "2028-06-30",
  rack1, 5, 2, "데이터베이스 서버").lastInsertRowid;
const srv4 = insertAsset.run("server", "백업서버", "Dell", "PowerEdge R640", "SRV-2024-004", "10.10.1.31", "SV-004", "active",
  "Windows Server 2022", "10.10.1.31", "", "김정보", "정보운영과",
  "2020-11-01", "2025-10-31", "2027-12-31",
  rack1, 7, 1, "백업 서버").lastInsertRowid;
insertAsset.run("server", "개발서버", "HP", "ProLiant DL360 Gen10", "SRV-2024-005", "10.10.1.41", "SV-005", "active",
  "Ubuntu 22.04 LTS", "10.10.1.41", "이개발", "김정보", "정보운영과",
  "2019-08-01", "2024-07-31", "2026-06-30",
  rack4, 1, 2, "개발/테스트 서버");

// 네트워크
const sw1 = insertAsset.run("network", "코어스위치", "Cisco", "Catalyst 9300", "NET-2024-001", "10.10.0.1", "NW-001", "active",
  "IOS-XE 17.9", "10.10.0.1", "", "최네트", "정보운영과",
  "2023-01-10", "2028-01-09", "2030-12-31",
  rack2, 1, 1, "L3 코어 스위치").lastInsertRowid;
const sw2 = insertAsset.run("network", "액세스스위치-01", "Cisco", "Catalyst 2960X", "NET-2024-002", "10.10.0.2", "NW-002", "active",
  "IOS 15.2", "10.10.0.2", "", "최네트", "정보운영과",
  "2019-05-20", "2024-05-19", "",
  rack2, 2, 1, "1층 액세스 스위치").lastInsertRowid;
const sw3 = insertAsset.run("network", "액세스스위치-02", "Cisco", "Catalyst 2960X", "NET-2024-003", "10.10.0.3", "NW-003", "eos",
  "IOS 15.2", "10.10.0.3", "", "최네트", "정보운영과",
  "2018-03-15", "2023-03-14", "2025-10-31",
  rack2, 3, 1, "2층 액세스 스위치 (EoS 도래)").lastInsertRowid;
insertAsset.run("network", "무선AP컨트롤러", "Aruba", "7010", "NET-2024-004", "10.10.0.10", "NW-004", "active",
  "ArubaOS 8.10", "10.10.0.10", "", "최네트", "정보운영과",
  "2022-07-01", "2027-06-30", "",
  rack2, 4, 1, "무선 AP 컨트롤러");

// 보안
const fwId = insertAsset.run("security", "방화벽", "Palo Alto", "PA-3260", "SEC-2024-001", "10.10.0.100", "SE-001", "active",
  "PAN-OS 11.1", "10.10.0.100", "", "이보안", "정보보호과",
  "2023-06-01", "2028-05-31", "2030-06-30",
  rack3, 1, 2, "메인 방화벽").lastInsertRowid;
insertAsset.run("security", "IPS", "AhnLab", "AIPS 4000", "SEC-2024-002", "10.10.0.101", "SE-002", "active",
  "AIPS v4.3", "10.10.0.101", "", "이보안", "정보보호과",
  "2021-09-01", "2026-08-31", "2028-12-31",
  rack3, 3, 1, "침입방지시스템");
insertAsset.run("security", "웹방화벽", "Penta Security", "WAPPLES", "SEC-2024-003", "10.10.0.102", "SE-003", "active",
  "WAPPLES v6.0", "10.10.0.102", "", "이보안", "정보보호과",
  "2022-01-15", "2027-01-14", "",
  rack3, 4, 1, "웹 애플리케이션 방화벽");
insertAsset.run("security", "NAC", "Genian", "NAC 5.0", "SEC-2024-004", "10.10.0.103", "SE-004", "active",
  "GPI v5.0.42", "10.10.0.103", "", "이보안", "정보보호과",
  "2020-04-01", "2025-03-31", "2027-06-30",
  rack3, 5, 1, "네트워크접근제어");

// 전화설비
const pbxId = insertAsset.run("telecom", "전화교환기", "Samsung", "SCM-8000", "TEL-2024-001", "10.10.5.1", "PBX-001", "active",
  "SCM v3.2", "10.10.5.1", "", "최네트", "정보운영과",
  "2021-12-01", "2026-11-30", "",
  rack1, 9, 4, "IP-PBX 전화교환기").lastInsertRowid;

// ============================================================
// asset_ips (다중 IP)
// ============================================================
const insertIp = db.prepare(`INSERT INTO asset_ips (asset_id, ip_address, ip_type, interface_name, is_primary, description) VALUES (?,?,?,?,?,?)`);

// 웹서버-01
insertIp.run(srv1, "10.10.1.11", "management", "eth0", 1, "관리 IP");
insertIp.run(srv1, "10.10.2.11", "service", "eth1", 0, "서비스 IP");
insertIp.run(srv1, "10.10.99.11", "management", "iDRAC", 0, "원격관리 콘솔");

// 웹서버-02
insertIp.run(srv2, "10.10.1.12", "management", "eth0", 1, "관리 IP");
insertIp.run(srv2, "10.10.2.12", "service", "eth1", 0, "서비스 IP");
insertIp.run(srv2, "10.10.99.12", "management", "iDRAC", 0, "원격관리 콘솔");

// DB서버-01
insertIp.run(srv3, "10.10.1.21", "management", "eth0", 1, "관리 IP");
insertIp.run(srv3, "10.10.2.21", "service", "eth1", 0, "서비스 IP");
insertIp.run(srv3, "10.10.99.21", "management", "iLO", 0, "원격관리 콘솔");

// 백업서버
insertIp.run(srv4, "10.10.1.31", "management", "eth0", 1, "관리 IP");
insertIp.run(srv4, "10.10.99.31", "management", "iDRAC", 0, "원격관리 콘솔");

// 코어스위치
insertIp.run(sw1, "10.10.0.1", "management", "Vlan1", 1, "관리 IP");
insertIp.run(sw1, "10.10.0.254", "vip", "Lo0", 0, "VIP 루프백");

// 방화벽
insertIp.run(fwId, "10.10.0.100", "management", "mgmt", 1, "관리 IP");
insertIp.run(fwId, "10.10.100.1", "service", "eth1-1", 0, "외부 서비스");
insertIp.run(fwId, "10.10.200.1", "service", "eth1-2", 0, "내부 서비스");

// 전화교환기
insertIp.run(pbxId, "10.10.5.1", "management", "eth0", 1, "관리 IP");
insertIp.run(pbxId, "10.10.5.2", "service", "eth1", 0, "서비스 IP");

// ============================================================
// custom_fields
// ============================================================
const insertField = db.prepare(`INSERT INTO custom_fields
  (field_key, field_label, field_type, field_group, options, asset_types, sort_order, is_required, show_in_table, show_in_detail)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);

// 기본 그룹
const cf1 = insertField.run('cpu_spec', 'CPU 사양', 'text', '기본', '', 'server', 1, 0, 1, 1).lastInsertRowid;
const cf2 = insertField.run('ram_gb', '메모리(GB)', 'number', '기본', '', 'server', 2, 0, 1, 1).lastInsertRowid;
const cf3 = insertField.run('disk_spec', '디스크 구성', 'text', '기본', '', 'server,storage', 3, 0, 0, 1).lastInsertRowid;

// 운영 그룹
const cf4 = insertField.run('firmware_ver', '펌웨어 버전', 'text', '운영', '', '', 4, 0, 0, 1).lastInsertRowid;
const cf5 = insertField.run('purpose', '용도', 'textarea', '운영', '', '', 5, 0, 0, 1).lastInsertRowid;

const cf6 = insertField.run('maint_contract', '유지보수 계약', 'select', '계약', 'AMT,자체,미체결', '', 13, 0, 0, 1).lastInsertRowid;

// 네트워크 그룹
const cf7 = insertField.run('additional_ips', '추가 IP', 'multi-text', '네트워크', '', 'server,network,security', 20, 0, 0, 1).lastInsertRowid;


// ============================================================
// custom_values
// ============================================================
const insertValue = db.prepare('INSERT INTO custom_values (asset_id, field_id, value) VALUES (?,?,?)');

// 웹서버-01
insertValue.run(srv1, cf1, 'Xeon Gold 6248R x2');
insertValue.run(srv1, cf2, '256');
insertValue.run(srv1, cf3, 'SSD 960GB x2 RAID1 + HDD 2TB x4 RAID5');
insertValue.run(srv1, cf5, '기관 홈페이지, 대민포털 서비스');
insertValue.run(srv1, cf6, 'AMT');
insertValue.run(srv1, cf7, JSON.stringify(['10.10.2.11', '10.10.99.11']));

// 웹서버-02
insertValue.run(srv2, cf1, 'Xeon Gold 6248R x2');
insertValue.run(srv2, cf2, '128');
insertValue.run(srv2, cf3, 'SSD 960GB x2 RAID1');
insertValue.run(srv2, cf6, 'AMT');
insertValue.run(srv2, cf7, JSON.stringify(['10.10.2.12', '10.10.99.12']));

// DB서버-01
insertValue.run(srv3, cf1, 'Xeon Gold 6230 x2');
insertValue.run(srv3, cf2, '512');
insertValue.run(srv3, cf3, 'SSD 960GB x2 RAID1 + HDD 4TB x8 RAID6');
insertValue.run(srv3, cf5, 'Oracle DB 19c, 행정정보 DB');
insertValue.run(srv3, cf6, 'AMT');
insertValue.run(srv3, cf7, JSON.stringify(['10.10.2.21', '10.10.99.21']));

// ============================================================
// ports (코어 스위치 48+2포트)
// ============================================================
const insertPort = db.prepare(`INSERT INTO ports (asset_id, port_number, port_name, port_type, speed, status, vlan, description) VALUES (?,?,?,?,?,?,?,?)`);

for (let i = 1; i <= 48; i++) {
  const status = i <= 12 ? "used" : i <= 14 ? "reserved" : "unused";
  const vlan = i <= 4 ? "10" : i <= 8 ? "20" : i <= 12 ? "30" : "";
  insertPort.run(sw1, i, `Gi1/0/${i}`, "ethernet", "1Gbps", status, vlan, "");
}
insertPort.run(sw1, 49, "Te1/1/1", "sfp_plus", "10Gbps", "used", "", "업링크");
insertPort.run(sw1, 50, "Te1/1/2", "sfp_plus", "10Gbps", "unused", "", "");

// 액세스스위치-01 (24포트)
for (let i = 1; i <= 24; i++) {
  const status = i <= 16 ? "used" : "unused";
  insertPort.run(sw2, i, `Gi0/${i}`, "ethernet", "1Gbps", status, i <= 8 ? "10" : "20", "");
}
// 액세스스위치-02 (24포트)
for (let i = 1; i <= 24; i++) {
  const status = i <= 10 ? "used" : "unused";
  insertPort.run(sw3, i, `Gi0/${i}`, "ethernet", "1Gbps", status, i <= 10 ? "20" : "", "");
}

// 서버 포트
for (const [srvId, name] of [[srv1, "웹서버-01"], [srv2, "웹서버-02"], [srv3, "DB서버-01"], [srv4, "백업서버"]]) {
  insertPort.run(srvId, 1, "eth0", "ethernet", "1Gbps", "used", "", `${name} 관리포트`);
  insertPort.run(srvId, 2, "eth1", "ethernet", "1Gbps", "used", "", `${name} 서비스포트`);
  insertPort.run(srvId, 3, "iLO/iDRAC", "management", "1Gbps", "used", "", `${name} 관리콘솔`);
}

// 포트 간 연결
const updateConnected = db.prepare("UPDATE ports SET connected_to_port_id = ? WHERE id = ?");
const corePorts = db.prepare("SELECT id FROM ports WHERE asset_id = ? AND port_number = ?");
const coreP1 = corePorts.get(sw1, 1);
const srv1P2 = db.prepare("SELECT id FROM ports WHERE asset_id = ? AND port_name = 'eth1'").get(srv1);
if (coreP1 && srv1P2) {
  updateConnected.run(srv1P2.id, coreP1.id);
  updateConnected.run(coreP1.id, srv1P2.id);
}

// ============================================================
// TPS실 (층별 통신단자함실) - 본원, 증축, 서울청사
// ============================================================
const tpsBuildings = [
  { name: "본원", floors: ["B1", "1F", "2F", "3F", "4F", "5F", "6F", "7F", "8F"] },
  { name: "증축", floors: ["B1", "1F", "2F", "3F", "4F", "5F", "6F"] },
  { name: "서울청사", floors: ["3F", "4F", "5F", "6F", "7F", "8F", "9F", "10F"] },
];

const tpsAssets = [];

for (const bldg of tpsBuildings) {
  for (const floor of bldg.floors) {
    // 위치 등록
    const locId = insertLocation.run(
      `${bldg.name} ${floor} TPS실`, bldg.name, floor, "TPS실"
    ).lastInsertRowid;

    // 12U 통신랙
    const rackId = insertRack.run(
      locId, `${bldg.name.charAt(0)}-${floor}`, 12, `${bldg.name} ${floor} 통신랙`
    ).lastInsertRowid;

    // 각 TPS 랙에 액세스 스위치 1대 (24포트)
    const swPrefix = bldg.name === "본원" ? "MW" : bldg.name === "증축" ? "EX" : "SE";
    const swTag = `${swPrefix}-${floor}`;
    const floorNum = floor.replace(/[^\d]/g, "") || "0";
    const baseIp = bldg.name === "본원" ? "10.10.10" : bldg.name === "증축" ? "10.10.20" : "10.10.30";
    const ipAddr = `${baseIp}.${floorNum}`;

    const swId = insertAsset.run(
      "network", `${bldg.name} ${floor} 스위치`, "Cisco", "Catalyst 2960L-24",
      `TPS-${swTag}-001`, ipAddr, swTag, "active",
      "IOS 15.2", ipAddr, "", "최네트", "정보운영과",
      "2022-06-01", "2027-05-31", "",
      rackId, 1, 1, `${bldg.name} ${floor} TPS실 액세스 스위치`
    ).lastInsertRowid;

    tpsAssets.push({ swId, bldg: bldg.name, floor });

    // 24포트 스위치 포트 등록
    const usedCount = Math.floor(Math.random() * 12) + 8; // 8~19 포트 사용
    for (let p = 1; p <= 24; p++) {
      const pStatus = p <= usedCount ? "used" : "unused";
      const vlan = "100";
      insertPort.run(swId, p, `Gi0/${p}`, "ethernet", "1Gbps", pStatus, vlan,
        p <= usedCount ? `${floor} ${p}번 포트` : "");
    }

    // 패치패널 (other 유형, 48포트)
    insertAsset.run(
      "other", `${bldg.name} ${floor} 패치패널`, "Panduit", "CP48",
      `PP-${swTag}-001`, "", `PP-${swTag}`, "active",
      "", "", "", "최네트", "정보운영과",
      "2022-06-01", "", "",
      rackId, 2, 2, `${bldg.name} ${floor} UTP 패치패널 48포트`
    );
  }
}

// ============================================================
// dist_frames + frame_pairs — MDF실
// ============================================================
const insertFrame = db.prepare(`INSERT INTO dist_frames (location_id, rack_id, frame_name, frame_type, total_pairs, rack_unit_start, rack_unit_size, description) VALUES (?,?,?,?,?,?,?,?)`);

const insertPair = db.prepare(`INSERT INTO frame_pairs (frame_id, pair_number, status, label, source, destination) VALUES (?,?,?,?,?,?)`);

// MDF실 — 외선 110블록 (50pairs)
const mdfFrame1 = insertFrame.run(locMdf, rackMdf, "외선 110블록", "110block", 50, 1, 4, "KT 외선 연결 110블록").lastInsertRowid;
for (let i = 1; i <= 50; i++) {
  if (i <= 20) {
    insertPair.run(mdfFrame1, i, "used", `외선 ${i}번`, "KT MDF", "본원 내선교환기");
  } else if (i <= 25) {
    insertPair.run(mdfFrame1, i, "reserved", "", "", "");
  } else {
    insertPair.run(mdfFrame1, i, "unused", "", "", "");
  }
}

// MDF실 — 내선 110블록 (50pairs)
const mdfFrame2 = insertFrame.run(locMdf, rackMdf, "내선 110블록", "110block", 50, 5, 4, "내선 교환기 연결 110블록").lastInsertRowid;
const internalFloors = ["B1", "1F", "2F", "3F", "4F", "5F", "6F", "7F", "8F"];
for (let i = 1; i <= 50; i++) {
  if (i <= 30) {
    const fl = internalFloors[(i - 1) % internalFloors.length];
    insertPair.run(mdfFrame2, i, "used", `내선 ${1000 + i}`, `교환기 포트${i}`, `본원 ${fl} TPS`);
  } else if (i <= 35) {
    insertPair.run(mdfFrame2, i, "reserved", "", "", "");
  } else {
    insertPair.run(mdfFrame2, i, "unused", "", "", "");
  }
}

// MDF실 — 데이터 110블록 (50pairs)
const mdfFrame3 = insertFrame.run(locMdf, rackMdf, "데이터 110블록", "110block", 50, 9, 4, "데이터 배선 110블록").lastInsertRowid;
for (let i = 1; i <= 50; i++) {
  if (i <= 15) {
    const fl = internalFloors[(i - 1) % internalFloors.length];
    insertPair.run(mdfFrame3, i, "used", `데이터 ${i}`, `코어스위치 Gi${i}`, `본원 ${fl} TPS`);
  } else if (i <= 20) {
    insertPair.run(mdfFrame3, i, "reserved", "", "", "");
  } else {
    insertPair.run(mdfFrame3, i, "unused", "", "", "");
  }
}

// ============================================================
// dist_frames + frame_pairs — 각 TPS실 110블록
// ============================================================
for (const tps of tpsAssets) {
  const tpsLocId = db.prepare("SELECT l.id FROM locations l WHERE l.location_name = ?").get(`${tps.bldg} ${tps.floor} TPS실`)?.id;
  const tpsRackId = db.prepare("SELECT r.id FROM racks r WHERE r.location_id = ?").get(tpsLocId)?.id;

  if (tpsLocId && tpsRackId) {
    const frameId = insertFrame.run(
      tpsLocId, tpsRackId, "110블록", "110block", 25, 4, 2, `${tps.bldg} ${tps.floor} TPS 110블록`
    ).lastInsertRowid;

    const usedCount = Math.floor(Math.random() * 11) + 8; // 8~18
    const reservedCount = Math.floor(Math.random() * 2) + 1; // 1~2

    for (let i = 1; i <= 25; i++) {
      if (i <= usedCount) {
        insertPair.run(frameId, i, "used", `포트${i}`, "MDF 데이터블록", `${tps.floor} ${i}번 단말`);
      } else if (i <= usedCount + reservedCount) {
        insertPair.run(frameId, i, "reserved", "", "", "");
      } else {
        insertPair.run(frameId, i, "unused", "", "", "");
      }
    }
  }
}

// ============================================================
// 업체 (vendors)
// ============================================================
const insertVendor = db.prepare(`INSERT INTO vendors (vendor_name, contact_person, phone, email, address, business_number, vendor_type, notes) VALUES (?,?,?,?,?,?,?,?)`);
const v1 = insertVendor.run("(주)한국IT서비스", "김유지", "02-1234-5678", "support@kits.co.kr", "서울시 강남구", "123-45-67890", "maintenance", "서버/스토리지 유지보수").lastInsertRowid;
const v2 = insertVendor.run("시스코코리아", "박영업", "02-2345-6789", "sales@cisco.kr", "서울시 서초구", "234-56-78901", "supplier", "네트워크 장비 공급").lastInsertRowid;
const v3 = insertVendor.run("(주)보안솔루션", "이보안", "02-3456-7890", "info@secsol.co.kr", "서울시 용산구", "345-67-89012", "maintenance", "보안장비 유지보수").lastInsertRowid;

// ============================================================
// 계약 (contracts)
// ============================================================
const insertContract = db.prepare(`INSERT INTO contracts (vendor_id, contract_name, contract_type, start_date, end_date, amount, auto_renew, status, notes) VALUES (?,?,?,?,?,?,?,?,?)`);
insertContract.run(v1, "2024 서버 유지보수 계약", "maintenance", "2024-01-01", "2024-12-31", "36,000,000", 1, "active", "서버 5대 연간 유지보수");
insertContract.run(v2, "네트워크 장비 구매 계약", "purchase", "2023-01-10", "2023-12-31", "120,000,000", 0, "expired", "코어스위치 외 3대");
insertContract.run(v3, "보안장비 통합 유지보수", "maintenance", "2024-06-01", "2025-05-31", "48,000,000", 1, "active", "방화벽/IPS/WAF/NAC");

// ============================================================
// 반입/반출 (asset_movements)
// ============================================================
const insertMovement = db.prepare(`INSERT INTO asset_movements (asset_id, movement_type, movement_date, requester, approver, department, purpose, destination, equipment_desc, serial_number, status, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
insertMovement.run(srv1, "bring_in", "2022-03-15", "김정보", "박과장", "정보운영과", "신규 도입", "본관 전산실", "Dell PowerEdge R740", "SRV-2024-001", "completed", "초기 설치", "admin");
insertMovement.run(srv4, "bring_out", "2025-06-01", "김정보", "", "정보운영과", "디스크 교체 수리", "(주)한국IT서비스", "Dell PowerEdge R640", "SRV-2024-004", "requested", "디스크 장애로 반출", "admin");
insertMovement.run(null, "bring_in", "2025-06-10", "최네트", "박과장", "정보운영과", "유지보수 점검장비 반입", "본관 전산실", "노트북 외 1대", "", "approved", "업체 점검용", "admin");

// ============================================================
// 유지보수/장애 (maintenance_logs)
// ============================================================
const insertMaint = db.prepare(`INSERT INTO maintenance_logs (asset_id, log_type, occurred_at, resolved_at, reported_by, handled_by, severity, symptom, action_taken, vendor_id, cost, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
insertMaint.run(srv4, "failure", "2025-05-28", "", "김정보", "", "major", "디스크 RAID 경고 발생, 1개 디스크 Degraded", "", v1, "", "open", "디스크 교체 필요");
insertMaint.run(sw2, "maintenance", "2025-04-15", "2025-04-15", "최네트", "최네트", "minor", "IOS 업데이트 작업", "IOS 15.2(7)E → 15.2(7)E3 업데이트 완료", null, "", "resolved", "정기 패치");
insertMaint.run(srv1, "inspection", "2025-03-01", "2025-03-01", "김정보", "김정보", "minor", "연간 정기 점검", "하드웨어 상태 정상, 먼지 제거, 케이블 정리", v1, "0", "resolved", "");

// ============================================================
// IP 대역 (ip_subnets)
// ============================================================
const insertSubnet = db.prepare(`INSERT INTO ip_subnets (subnet_name, network_address, subnet_mask, gateway, vlan_id, location_id, description) VALUES (?,?,?,?,?,?,?)`);
insertSubnet.run("서버 관리 대역", "10.10.1.0", "255.255.255.0", "10.10.1.1", "10", loc1, "서버 관리용 네트워크");
insertSubnet.run("서버 서비스 대역", "10.10.2.0", "255.255.255.0", "10.10.2.1", "20", loc1, "서버 서비스용 네트워크");
insertSubnet.run("네트워크 관리 대역", "10.10.0.0", "255.255.255.0", "10.10.0.1", "1", loc1, "네트워크 장비 관리");
insertSubnet.run("서버 iDRAC/iLO 대역", "10.10.99.0", "255.255.255.0", "10.10.99.1", "99", loc1, "서버 관리콘솔 전용");
insertSubnet.run("본원 사용자 대역", "10.10.10.0", "255.255.255.0", "10.10.10.1", "100", loc1, "본원 TPS 사용자 네트워크");
insertSubnet.run("증축 사용자 대역", "10.10.20.0", "255.255.255.0", "10.10.20.1", "200", loc2, "증축동 TPS 사용자 네트워크");
insertSubnet.run("전화설비 대역", "10.10.5.0", "255.255.255.0", "10.10.5.1", "50", loc1, "IP-PBX 전화설비 네트워크");

// ============================================================
// 메뉴 권한 (menu_permissions) — 초기 권한 세트
// ============================================================
const insertPerm = db.prepare(`INSERT INTO menu_permissions (menu_key, role, can_access, can_write, can_approve) VALUES (?,?,?,?,?)`);

// 메뉴 키 목록
const menus = ['dashboard','assets','racks','portmap','topology','ipam','distribution','movements','maintenance','contracts','locations','settings'];

// admin: 전부 접근+쓰기+승인
for (const m of menus) {
  insertPerm.run(m, 'admin', 1, 1, 1);
}

// user: 합의된 기본 권한
const userPerms = {
  dashboard:     [1, 0, 0],
  assets:        [1, 1, 0],
  racks:         [1, 0, 0],
  portmap:       [1, 0, 0],
  topology:      [1, 0, 0],
  ipam:          [1, 0, 0],
  distribution:  [1, 0, 0],
  movements:     [1, 1, 0],  // 신청 가능, 승인 불가
  maintenance:   [1, 1, 0],
  contracts:     [0, 0, 0],  // 접근 불가
  locations:     [1, 0, 0],
  settings:      [1, 0, 0],
};
for (const [m, [a, w, ap]] of Object.entries(userPerms)) {
  insertPerm.run(m, 'user', a, w, ap);
}

// viewer: 최소 권한 (초기 신규 사용자 기본)
const viewerPerms = {
  dashboard:     [1, 0, 0],
  assets:        [1, 0, 0],
  racks:         [1, 0, 0],
  portmap:       [1, 0, 0],
  topology:      [1, 0, 0],
  ipam:          [1, 0, 0],
  distribution:  [0, 0, 0],
  movements:     [1, 0, 0],
  maintenance:   [1, 0, 0],
  contracts:     [0, 0, 0],
  locations:     [0, 0, 0],
  settings:      [1, 0, 0],
};
for (const [m, [a, w, ap]] of Object.entries(viewerPerms)) {
  insertPerm.run(m, 'viewer', a, w, ap);
}

// ============================================================
// 계약-자산 연동 (contract_assets)
// ============================================================
const insertCA = db.prepare(`INSERT INTO contract_assets (contract_id, asset_id) VALUES (?,?)`);
// 서버 유지보수 계약에 서버 5대 연결 (contract id=1)
insertCA.run(1, srv1);
insertCA.run(1, srv2);
insertCA.run(1, srv3);
insertCA.run(1, srv4);

console.log("✅ 시드 데이터 생성 완료 (전체)");
db.close();

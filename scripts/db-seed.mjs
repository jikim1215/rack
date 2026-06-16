import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "data.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// 스키마 생성
db.exec(`
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    building TEXT DEFAULT '',
    floor TEXT DEFAULT '',
    room TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS racks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    total_units INTEGER NOT NULL DEFAULT 42,
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
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
  CREATE TABLE IF NOT EXISTS custom_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field_key TEXT NOT NULL UNIQUE,
    field_label TEXT NOT NULL,
    field_type TEXT NOT NULL DEFAULT 'text' CHECK(field_type IN ('text','number','date','select','textarea')),
    options TEXT DEFAULT '',
    asset_types TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
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
`);

// 시드 데이터
db.exec(`
  DELETE FROM custom_values;
  DELETE FROM custom_fields;
  DELETE FROM ports;
  DELETE FROM assets;
  DELETE FROM racks;
  DELETE FROM locations;
`);

// 위치
const insertLocation = db.prepare("INSERT INTO locations (name, building, floor, room) VALUES (?,?,?,?)");
const loc1 = insertLocation.run("본관 전산실", "본관", "B1", "전산실A").lastInsertRowid;
const loc2 = insertLocation.run("별관 서버실", "별관", "3F", "서버실B").lastInsertRowid;

// 랙
const insertRack = db.prepare("INSERT INTO racks (location_id, name, total_units, description) VALUES (?,?,?,?)");
const rack1 = insertRack.run(loc1, "A-01", 42, "메인 서버랙").lastInsertRowid;
const rack2 = insertRack.run(loc1, "A-02", 42, "네트워크 장비랙").lastInsertRowid;
const rack3 = insertRack.run(loc1, "A-03", 42, "보안 장비랙").lastInsertRowid;
const rack4 = insertRack.run(loc2, "B-01", 24, "별관 서버랙").lastInsertRowid;

// 자산 (확장 필드 포함)
const insertAsset = db.prepare(`INSERT INTO assets
  (asset_type, name, manufacturer, model, serial_number, ip_address, asset_tag, status,
   os, access_ip, user_name, admin_name, department,
   rack_id, rack_unit_start, rack_unit_size, description)
  VALUES (?,?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?)`);

// 서버
const srv1 = insertAsset.run("server", "웹서버-01", "Dell", "PowerEdge R740", "SRV-2024-001", "10.10.1.11", "SV-001", "active",
  "Rocky Linux 8.9", "10.10.1.11", "", "김정보", "정보운영과", rack1, 1, 2, "메인 웹서버").lastInsertRowid;
const srv2 = insertAsset.run("server", "웹서버-02", "Dell", "PowerEdge R740", "SRV-2024-002", "10.10.1.12", "SV-002", "active",
  "Rocky Linux 8.9", "10.10.1.12", "", "김정보", "정보운영과", rack1, 3, 2, "보조 웹서버").lastInsertRowid;
const srv3 = insertAsset.run("server", "DB서버-01", "HP", "ProLiant DL380 Gen10", "SRV-2024-003", "10.10.1.21", "SV-003", "active",
  "Oracle Linux 8.8", "10.10.1.21", "", "박데이터", "정보운영과", rack1, 5, 2, "데이터베이스 서버").lastInsertRowid;
const srv4 = insertAsset.run("server", "백업서버", "Dell", "PowerEdge R640", "SRV-2024-004", "10.10.1.31", "SV-004", "active",
  "Windows Server 2022", "10.10.1.31", "", "김정보", "정보운영과", rack1, 7, 1, "백업 서버").lastInsertRowid;
insertAsset.run("server", "개발서버", "HP", "ProLiant DL360 Gen10", "SRV-2024-005", "10.10.1.41", "SV-005", "active",
  "Ubuntu 22.04 LTS", "10.10.1.41", "이개발", "김정보", "정보운영과", rack4, 1, 2, "개발/테스트 서버");

// 네트워크
const sw1 = insertAsset.run("network", "코어스위치", "Cisco", "Catalyst 9300", "NET-2024-001", "10.10.0.1", "NW-001", "active",
  "IOS-XE 17.9", "10.10.0.1", "", "최네트", "정보운영과", rack2, 1, 1, "L3 코어 스위치").lastInsertRowid;
const sw2 = insertAsset.run("network", "액세스스위치-01", "Cisco", "Catalyst 2960X", "NET-2024-002", "10.10.0.2", "NW-002", "active",
  "IOS 15.2", "10.10.0.2", "", "최네트", "정보운영과", rack2, 2, 1, "1층 액세스 스위치").lastInsertRowid;
const sw3 = insertAsset.run("network", "액세스스위치-02", "Cisco", "Catalyst 2960X", "NET-2024-003", "10.10.0.3", "NW-003", "active",
  "IOS 15.2", "10.10.0.3", "", "최네트", "정보운영과", rack2, 3, 1, "2층 액세스 스위치").lastInsertRowid;
insertAsset.run("network", "무선AP컨트롤러", "Aruba", "7010", "NET-2024-004", "10.10.0.10", "NW-004", "active",
  "ArubaOS 8.10", "10.10.0.10", "", "최네트", "정보운영과", rack2, 4, 1, "무선 AP 컨트롤러");

// 보안
insertAsset.run("security", "방화벽", "Palo Alto", "PA-3260", "SEC-2024-001", "10.10.0.100", "SE-001", "active",
  "PAN-OS 11.1", "10.10.0.100", "", "이보안", "정보보호과", rack3, 1, 2, "메인 방화벽");
insertAsset.run("security", "IPS", "AhnLab", "AIPS 4000", "SEC-2024-002", "10.10.0.101", "SE-002", "active",
  "AIPS v4.3", "10.10.0.101", "", "이보안", "정보보호과", rack3, 3, 1, "침입방지시스템");
insertAsset.run("security", "웹방화벽", "Penta Security", "WAPPLES", "SEC-2024-003", "10.10.0.102", "SE-003", "active",
  "WAPPLES v6.0", "10.10.0.102", "", "이보안", "정보보호과", rack3, 4, 1, "웹 애플리케이션 방화벽");
insertAsset.run("security", "NAC", "Genian", "NAC 5.0", "SEC-2024-004", "10.10.0.103", "SE-004", "active",
  "GPI v5.0.42", "10.10.0.103", "", "이보안", "정보보호과", rack3, 5, 1, "네트워크접근제어");

// 스토리지
insertAsset.run("storage", "SAN스토리지", "NetApp", "FAS2750", "STR-2024-001", "10.10.1.50", "ST-001", "active",
  "ONTAP 9.13", "10.10.1.50", "", "박데이터", "정보운영과", rack1, 9, 4, "SAN 스토리지");

// 커스텀 필드 예시 (사용자가 UI에서 추가 가능)
const insertField = db.prepare(`INSERT INTO custom_fields (field_key, field_label, field_type, options, asset_types, sort_order) VALUES (?,?,?,?,?,?)`);
const cf1 = insertField.run("cpu_spec", "CPU 사양", "text", "", "server", 1).lastInsertRowid;
const cf2 = insertField.run("ram_gb", "메모리(GB)", "number", "", "server", 2).lastInsertRowid;
const cf3 = insertField.run("disk_spec", "디스크 구성", "text", "", "server,storage", 3).lastInsertRowid;
const cf4 = insertField.run("firmware_ver", "펌웨어 버전", "text", "", "", 4).lastInsertRowid;
const cf5 = insertField.run("service_contract", "유지보수 계약", "select", "AMT,자체,미체결", "", 5).lastInsertRowid;
const cf6 = insertField.run("purpose", "용도", "textarea", "", "", 6).lastInsertRowid;

// 커스텀 필드 값 예시
const insertValue = db.prepare(`INSERT INTO custom_values (asset_id, field_id, value) VALUES (?,?,?)`);
insertValue.run(srv1, cf1, "Xeon Gold 6248R x2");
insertValue.run(srv1, cf2, "256");
insertValue.run(srv1, cf3, "SSD 960GB x2 RAID1 + HDD 2TB x4 RAID5");
insertValue.run(srv1, cf5, "AMT");
insertValue.run(srv1, cf6, "기관 홈페이지, 대민포털 서비스");

insertValue.run(srv2, cf1, "Xeon Gold 6248R x2");
insertValue.run(srv2, cf2, "128");
insertValue.run(srv2, cf3, "SSD 960GB x2 RAID1");
insertValue.run(srv2, cf5, "AMT");

insertValue.run(srv3, cf1, "Xeon Gold 6230 x2");
insertValue.run(srv3, cf2, "512");
insertValue.run(srv3, cf3, "SSD 960GB x2 RAID1 + HDD 4TB x8 RAID6");
insertValue.run(srv3, cf5, "AMT");
insertValue.run(srv3, cf6, "Oracle DB 19c, 행정정보 DB");

// 포트 정보 (코어 스위치)
const insertPort = db.prepare(`INSERT INTO ports (asset_id, port_number, port_name, port_type, speed, status, vlan, description) VALUES (?,?,?,?,?,?,?,?)`);

for (let i = 1; i <= 48; i++) {
  const status = i <= 12 ? "used" : i <= 14 ? "reserved" : "unused";
  const vlan = i <= 4 ? "10" : i <= 8 ? "20" : i <= 12 ? "30" : "";
  insertPort.run(sw1, i, `Gi1/0/${i}`, "ethernet", "1Gbps", status, vlan, "");
}
insertPort.run(sw1, 49, "Te1/1/1", "sfp_plus", "10Gbps", "used", "", "업링크");
insertPort.run(sw1, 50, "Te1/1/2", "sfp_plus", "10Gbps", "unused", "", "");

for (let i = 1; i <= 24; i++) {
  const status = i <= 16 ? "used" : "unused";
  insertPort.run(sw2, i, `Gi0/${i}`, "ethernet", "1Gbps", status, i <= 8 ? "10" : "20", "");
}
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

console.log("✅ 시드 데이터 생성 완료 (확장 필드 포함)");
db.close();

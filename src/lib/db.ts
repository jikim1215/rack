import Database from "better-sqlite3";
import path from "path";

// DB 파일 경로: ASSET_DB_PATH(절대/상대) 우선, 없으면 cwd/data.db.
// (Next standalone server.js는 기동 시 자기 디렉터리로 chdir하므로, seed가 쓴 파일과
//  서버가 읽는 파일이 어긋나는 것을 ASSET_DB_PATH로 고정한다.)
const DB_PATH = process.env.ASSET_DB_PATH
  ? path.resolve(process.env.ASSET_DB_PATH)
  : path.join(process.cwd(), "data.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    _db.pragma("busy_timeout = 5000");
    initSchema(_db);
    // 빈 DB 경고: users가 0명이면 시드/이관 누락 또는 잘못된 DB 경로 → 로그인 불가 상태를 부팅 로그로 명확히 알림.
    try {
      const n = (_db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
      if (n === 0) {
        console.warn(`[SETUP] '${DB_PATH}' 에 등록된 사용자가 없습니다. 'npm run db:seed'(또는 데이터 이관)을 먼저 실행하세요. 그렇지 않으면 로그인이 불가합니다.`);
      }
    } catch { /* 스키마 초기화 직후라 무시 */ }
  }
  return _db;
}

// 재빌드형 마이그레이션 직후 FK 위반을 침묵 통과시키지 않는다 (R2 비평 반영)
function assertNoFkViolations(db: Database.Database, context: string) {
  const violations = db.pragma("foreign_key_check") as unknown[];
  if (Array.isArray(violations) && violations.length > 0) {
    throw new Error(`[MIGRATION] ${context}: foreign_key_check 위반 ${violations.length}건 — ${JSON.stringify(violations.slice(0, 5))}`);
  }
}

function initSchema(db: Database.Database) {
  db.exec(`
    -- 사용자
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'team' CHECK(role IN ('admin','team','viewer')),
      is_active INTEGER DEFAULT 1,
      must_change_password INTEGER DEFAULT 0,
      team_id INTEGER REFERENCES teams(id),
      token_version INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 메일 릴레이 설정 (단일행, id=1). 폐쇄망 사내 SMTP 릴레이(허용 IP 방식, 무인증) 정보.
    --   비밀번호 전달용 아님 — 초기화 통지 등 알림 메일 발송에만 사용. enabled=1 + 필수값 완비 시 활성.
    CREATE TABLE IF NOT EXISTS mail_relay_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      host TEXT DEFAULT '',
      port INTEGER DEFAULT 25,
      security TEXT NOT NULL DEFAULT 'NONE' CHECK(security IN ('NONE','STARTTLS','TLS')),
      from_address TEXT DEFAULT '',
      from_name TEXT DEFAULT '',
      base_url TEXT DEFAULT '',
      enabled INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 위치
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_name TEXT NOT NULL,
      building TEXT DEFAULT '',
      floor TEXT DEFAULT '',
      room TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 999,
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
      asset_type TEXT NOT NULL,
      asset_name TEXT NOT NULL,
      manufacturer TEXT DEFAULT '',
      model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      asset_tag TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','maintenance','standby','retired')),
      network_zone TEXT DEFAULT '',
      purchase_date TEXT DEFAULT '',
      warranty_date TEXT DEFAULT '',
      eos_date TEXT DEFAULT '',
      description TEXT DEFAULT '',
      os TEXT DEFAULT '',
      access_ip TEXT DEFAULT '',
      user_name TEXT DEFAULT '',
      admin_name TEXT DEFAULT '',
      department TEXT DEFAULT '',
      team_id INTEGER REFERENCES teams(id),
      cia_c INTEGER,
      cia_i INTEGER,
      cia_a INTEGER,
      import_batch_id TEXT,
      cia_total INTEGER GENERATED ALWAYS AS (CASE WHEN cia_c IS NULL OR cia_i IS NULL OR cia_a IS NULL THEN NULL ELSE cia_c+cia_i+cia_a END) VIRTUAL,
      cia_grade TEXT GENERATED ALWAYS AS (CASE WHEN cia_c IS NULL OR cia_i IS NULL OR cia_a IS NULL THEN '' WHEN cia_c+cia_i+cia_a>=7 THEN 'H' WHEN cia_c+cia_i+cia_a>=5 THEN 'M' ELSE 'L' END) VIRTUAL,
      rack_id INTEGER REFERENCES racks(id) ON DELETE SET NULL,
      rack_unit_start INTEGER,
      rack_unit_size INTEGER DEFAULT 1,
      rack_side TEXT CHECK(rack_side IN ('L','R')),
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

    -- 감사 로그 (공통)
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL DEFAULT 'asset' CHECK(entity_type IN ('asset','rack','location','frame','contract','movement','maintenance','inventory_audit','sub_asset')),
      entity_id INTEGER,
      entity_name TEXT DEFAULT '',
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
      core_number INTEGER,
      linked_pair_id INTEGER REFERENCES frame_pairs(id) ON DELETE SET NULL,
      connected_port_id INTEGER REFERENCES ports(id) ON DELETE SET NULL,
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
    
    -- 계약-자산 연동 (N:M)
    CREATE TABLE IF NOT EXISTS contract_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      UNIQUE(contract_id, asset_id)
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
      model TEXT DEFAULT '',
      size_u TEXT DEFAULT '',
      manufacturer TEXT DEFAULT '',
      rack_position TEXT DEFAULT '',
      power_watts TEXT DEFAULT '',
      power_redundant TEXT DEFAULT '',
      status TEXT DEFAULT 'requested' CHECK(status IN ('requested','approved','completed','rejected')),
      notes TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 유지보수/장애
    CREATE TABLE IF NOT EXISTS maintenance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
      asset_name TEXT DEFAULT '',
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

    -- 유지관리 대상/금액 산정 기록
    CREATE TABLE IF NOT EXISTS maintenance_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
      asset_name TEXT DEFAULT '',
      system_name TEXT DEFAULT '',
      category TEXT DEFAULT '',
      asset_type_label TEXT DEFAULT '',
      resource_name TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      manufacturer TEXT DEFAULT '',
      host_name TEXT DEFAULT '',
      purpose TEXT DEFAULT '',
      location_text TEXT DEFAULT '',
      rack_position TEXT DEFAULT '',
      asset_code TEXT DEFAULT '',
      owner_department TEXT DEFAULT '',
      owner_user TEXT DEFAULT '',
      acquisition_date TEXT DEFAULT '',
      acquisition_amount TEXT DEFAULT '',
      maintenance_start TEXT DEFAULT '',
      maintenance_end TEXT DEFAULT '',
      maintenance_months INTEGER DEFAULT 0,
      business_impact TEXT DEFAULT '',
      data_importance TEXT DEFAULT '',
      user_traffic TEXT DEFAULT '',
      hardware_score TEXT DEFAULT '',
      maintenance_difficulty TEXT DEFAULT '',
      maintenance_scope TEXT DEFAULT '',
      score_total TEXT DEFAULT '',
      grade TEXT DEFAULT '',
      rate TEXT DEFAULT '',
      estimated_amount_calc TEXT DEFAULT '',
      estimated_amount_input TEXT DEFAULT '',
      evidence_note TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      updated_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
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

    -- 메뉴 권한
    CREATE TABLE IF NOT EXISTS menu_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_key TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','team','viewer')),
      can_access INTEGER DEFAULT 1,
      can_write INTEGER DEFAULT 0,
      can_approve INTEGER DEFAULT 0,
      UNIQUE(menu_key, role)
    );

    -- 팀(부서 대체 소유주체) — ADR-009: team_id가 자산 소유권의 권위, department는 레거시 음영 컬럼
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 가져오기(임포트) 이슈 큐
    CREATE TABLE IF NOT EXISTS import_issue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      source_row INTEGER,
      asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
      issue_type TEXT NOT NULL CHECK(issue_type IN ('ip_format','missing_id','missing_os','dup_suspect')),
      raw_value TEXT DEFAULT '',
      parsed_value TEXT DEFAULT '',
      note TEXT DEFAULT '',
      -- 처리 상태 (외부 검토 R7-1 합의): open=미조치 / resolved=조치완료 / ignored=무시 — 사람이 큐를 비울 수 있어야 운영 화면이 된다
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')),
      resolved_by TEXT DEFAULT '',
      resolved_at TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 접근(인증) 로그
    CREATE TABLE IF NOT EXISTS access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      action TEXT NOT NULL CHECK(action IN ('login','logout','fail')),
      result_code TEXT DEFAULT '',
      failure_reason TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 인덱스
    CREATE INDEX IF NOT EXISTS idx_assets_rack ON assets(rack_id);
    CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);
    CREATE INDEX IF NOT EXISTS idx_asset_ips_asset ON asset_ips(asset_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_ports_asset ON ports(asset_id);
    CREATE INDEX IF NOT EXISTS idx_ports_connected ON ports(connected_to_port_id);
    CREATE INDEX IF NOT EXISTS idx_custom_values_asset ON custom_values(asset_id);
    CREATE INDEX IF NOT EXISTS idx_custom_values_field ON custom_values(field_id);
    CREATE INDEX IF NOT EXISTS idx_dist_frames_location ON dist_frames(location_id);
    CREATE INDEX IF NOT EXISTS idx_frame_pairs_frame ON frame_pairs(frame_id);
    CREATE INDEX IF NOT EXISTS idx_movements_asset ON asset_movements(asset_id);
    CREATE INDEX IF NOT EXISTS idx_contract_assets_asset ON contract_assets(asset_id);
    CREATE INDEX IF NOT EXISTS idx_maintenance_asset ON maintenance_logs(asset_id);
    CREATE INDEX IF NOT EXISTS idx_maintenance_targets_asset ON maintenance_targets(asset_id);
    CREATE INDEX IF NOT EXISTS idx_maintenance_targets_code ON maintenance_targets(asset_code);
    CREATE INDEX IF NOT EXISTS idx_contracts_vendor ON contracts(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_subnets_location ON ip_subnets(location_id);

    -- 로그인 시도 제한 (재시작·멀티프로세스 내성, R1 비평 반영). key = "u:<username>" 또는 "ip:<ip>"
    CREATE TABLE IF NOT EXISTS login_attempts (
      key TEXT PRIMARY KEY,
      fail_count INTEGER NOT NULL DEFAULT 0,
      first_fail_at INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0
    );

    -- 자산실사 회차
    CREATE TABLE IF NOT EXISTS inventory_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
      started_at TEXT DEFAULT (datetime('now','localtime')),
      closed_at TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      description TEXT DEFAULT '',
      -- 마감 시점 스냅샷 (조회 시점 대상 집합은 유동이므로 증빙 재현성 확보, 비평 합의 R3-2)
      closed_total INTEGER,
      closed_checked INTEGER,
      closed_mismatch INTEGER,
      closed_equip_checked INTEGER,
      closed_sub_checked INTEGER
    );

    -- 자산실사 확인 기록 (회차당 대상 1행 — 장비(asset_id) 또는 부속자산(sub_asset_id) 중 정확히 하나)
    CREATE TABLE IF NOT EXISTS inventory_audit_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id INTEGER NOT NULL REFERENCES inventory_audits(id) ON DELETE CASCADE,
      asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
      sub_asset_id INTEGER REFERENCES sub_assets(id) ON DELETE CASCADE,
      result TEXT NOT NULL DEFAULT 'confirmed' CHECK(result IN ('confirmed','missing','moved','disposed')),
      note TEXT DEFAULT '',
      checked_by TEXT DEFAULT '',
      checked_at TEXT DEFAULT (datetime('now','localtime')),
      CHECK((asset_id IS NULL) != (sub_asset_id IS NULL)),
      UNIQUE(audit_id, asset_id),
      UNIQUE(audit_id, sub_asset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_audit_checks_audit ON inventory_audit_checks(audit_id);
    CREATE INDEX IF NOT EXISTS idx_audit_checks_asset ON inventory_audit_checks(asset_id);
    CREATE INDEX IF NOT EXISTS idx_audit_checks_sub ON inventory_audit_checks(sub_asset_id);

    -- 부속자산 (S/W·기반설비·메모리·모듈·디스크·주변기기·비품 등 재물 관점 품목)
    -- 장비(assets)와 라이프사이클이 달라 별도 테이블: 실장/IP/반출입 흐름을 타지 않는다 (ADR 예정).
    CREATE TABLE IF NOT EXISTS sub_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_code TEXT NOT NULL DEFAULT '',
      category_major TEXT DEFAULT '',
      category_mid TEXT DEFAULT '',
      category_minor TEXT DEFAULT '',
      sub_name TEXT NOT NULL,
      spec TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      acquired_date TEXT DEFAULT '',
      user_name TEXT DEFAULT '',
      place TEXT DEFAULT '',
      purpose TEXT DEFAULT '',
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disposed')),
      parent_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
      team_id INTEGER REFERENCES teams(id),
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_sub_assets_code ON sub_assets(asset_code);
    CREATE INDEX IF NOT EXISTS idx_sub_assets_parent ON sub_assets(parent_asset_id);
    CREATE INDEX IF NOT EXISTS idx_sub_assets_cat ON sub_assets(category_mid, category_minor);
    CREATE INDEX IF NOT EXISTS idx_menu_perms ON menu_permissions(role, menu_key);
    CREATE INDEX IF NOT EXISTS idx_asset_ips_ip ON asset_ips(ip_address);
    CREATE INDEX IF NOT EXISTS idx_access_logs_created ON access_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_access_logs_username ON access_logs(username);
    CREATE INDEX IF NOT EXISTS idx_access_logs_action ON access_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_id ON audit_logs(created_at, id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_type_created ON audit_logs(entity_type, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_import_issue_batch ON import_issue(batch_id);
  `);

  // 기존 DB 마이그레이션
  const cols = db.prepare("PRAGMA table_info(assets)").all() as any[];
  const colNames = new Set(cols.map((c: any) => c.name));
  for (const [name, def] of [
    ["os", "TEXT DEFAULT ''"], ["access_ip", "TEXT DEFAULT ''"],
    ["user_name", "TEXT DEFAULT ''"], ["admin_name", "TEXT DEFAULT ''"],
    ["department", "TEXT DEFAULT ''"], ["eos_date", "TEXT DEFAULT ''"],
    // 임포트 배치 추적 (외부 검토 R8-4 합의): 생성 자산 ↔ 업로드 배치 직접 연결 — 배치 롤백/사후 재구성 기반
    ["import_batch_id", "TEXT"],
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

  // locations 정렬 순서 (기존 DB) — 랙 실장도 등 위치 기반 정렬의 기준 (기본 999 = 미지정 후순위)
  {
    const locCols = new Set((db.prepare("PRAGMA table_info(locations)").all() as any[]).map((c: any) => c.name));
    if (!locCols.has("sort_order")) db.exec(`ALTER TABLE locations ADD COLUMN sort_order INTEGER DEFAULT 999`);
  }

  // inventory_audits 마감 스냅샷 컬럼 (기존 DB)
  {
    const iaCols = new Set((db.prepare("PRAGMA table_info(inventory_audits)").all() as any[]).map((c: any) => c.name));
    if (!iaCols.has("closed_total")) db.exec(`ALTER TABLE inventory_audits ADD COLUMN closed_total INTEGER`);
    if (!iaCols.has("closed_checked")) db.exec(`ALTER TABLE inventory_audits ADD COLUMN closed_checked INTEGER`);
    // 마감 스냅샷 확장 (외부 검토 R8-6 합의): 불일치 수 + 장비/부속 구분 수
    if (!iaCols.has("closed_mismatch")) db.exec(`ALTER TABLE inventory_audits ADD COLUMN closed_mismatch INTEGER`);
    if (!iaCols.has("closed_equip_checked")) db.exec(`ALTER TABLE inventory_audits ADD COLUMN closed_equip_checked INTEGER`);
    if (!iaCols.has("closed_sub_checked")) db.exec(`ALTER TABLE inventory_audits ADD COLUMN closed_sub_checked INTEGER`);
  }

  // import_issue 처리 상태 컬럼 (기존 DB) — 외부 검토 R7-1/R7-2 합의
  {
    const iiCols = new Set((db.prepare("PRAGMA table_info(import_issue)").all() as any[]).map((c: any) => c.name));
    if (!iiCols.has("status")) db.exec(`ALTER TABLE import_issue ADD COLUMN status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored'))`);
    if (!iiCols.has("resolved_by")) db.exec(`ALTER TABLE import_issue ADD COLUMN resolved_by TEXT DEFAULT ''`);
    if (!iiCols.has("resolved_at")) db.exec(`ALTER TABLE import_issue ADD COLUMN resolved_at TEXT DEFAULT ''`);
    if (!iiCols.has("created_by")) db.exec(`ALTER TABLE import_issue ADD COLUMN created_by TEXT DEFAULT ''`);
  }

  // frame_pairs 마이그레이션: 선번장(FDF/110블록) 양단 링크·코어번호·장비포트 연결 (ADR: FDF A안)
  const fpCols = db.prepare("PRAGMA table_info(frame_pairs)").all() as any[];
  const fpColNames = new Set(fpCols.map((c: any) => c.name));
  for (const [name, def] of [
    ["core_number", "INTEGER"],
    ["linked_pair_id", "INTEGER REFERENCES frame_pairs(id) ON DELETE SET NULL"],
    ["connected_port_id", "INTEGER REFERENCES ports(id) ON DELETE SET NULL"],
  ]) {
    if (!fpColNames.has(name)) {
      db.exec(`ALTER TABLE frame_pairs ADD COLUMN ${name} ${def}`);
    }
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_frame_pairs_linked ON frame_pairs(linked_pair_id);
    CREATE INDEX IF NOT EXISTS idx_frame_pairs_port ON frame_pairs(connected_port_id);
  `);

  // 부서 독립 운영(ADR-011): 인프라 테이블에 소유 팀(team_id) 컬럼 추가.
  //  - racks/locations: 하이브리드 가시성(소유 OR 파생) — 공유 센터/랙은 NULL로 두고 자산 기반 파생.
  //  - dist_frames/ip_subnets/contracts: 소유 전용(team_id) — 팀별 독립 운영. NULL = 총괄 전용.
  // 기존 행은 전부 NULL(공유)로 시작한다: 랙/위치는 파생으로 자동 노출, 나머지는 총괄이 소유를 배정한다.
  for (const table of ["locations", "racks", "dist_frames", "ip_subnets", "contracts"]) {
    const cs = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c: any) => c.name));
    if (!cs.has("team_id")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN team_id INTEGER REFERENCES teams(id)`);
    }
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_locations_team ON locations(team_id);
    CREATE INDEX IF NOT EXISTS idx_racks_team ON racks(team_id);
    CREATE INDEX IF NOT EXISTS idx_racks_location ON racks(location_id);
    CREATE INDEX IF NOT EXISTS idx_frames_team ON dist_frames(team_id);
    CREATE INDEX IF NOT EXISTS idx_frames_location ON dist_frames(location_id);
    CREATE INDEX IF NOT EXISTS idx_subnets_team ON ip_subnets(team_id);
    CREATE INDEX IF NOT EXISTS idx_subnets_location ON ip_subnets(location_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_team ON contracts(team_id);
  `);

  // firmware_ver / purpose(용도) 커스텀필드 폐기: 펌웨어는 OS 컬럼에 통합 기록, 용도는 설명(description)과 중복.
  // user_version 게이트: 일회성 마이그레이션 — 매 부팅 실행하면 운영자의 수동 재활성화를 계속 덮어쓴다 (R2 비평 반영).
  const uv = Number(db.pragma("user_version", { simple: true }) || 0);
  if (uv < 1) {
    db.prepare("UPDATE custom_fields SET is_active = 0 WHERE field_key IN ('firmware_ver','purpose')").run();
    db.pragma("user_version = 1");
  }

  // 자산실사(inspection) 메뉴 권한 시드 — 기존 DB에 행이 없으면 추가 (admin 전체 / team 체크 가능 / viewer 열람만)
  db.exec(`
    INSERT OR IGNORE INTO menu_permissions (menu_key, role, can_access, can_write, can_approve) VALUES
      ('inspection','admin',1,1,1),
      ('inspection','team',1,1,0),
      ('inspection','viewer',1,0,0);
  `);

  // 부속자산(subassets) 메뉴 권한 시드 (admin 전체 / team 쓰기 / viewer 열람)
  db.exec(`
    INSERT OR IGNORE INTO menu_permissions (menu_key, role, can_access, can_write, can_approve) VALUES
      ('subassets','admin',1,1,1),
      ('subassets','team',1,1,0),
      ('subassets','viewer',1,0,0);
  `);

  // 통계 리포트(reports) 메뉴 권한 시드 (읽기 전용 — 제출용 집계, 쓰기/승인 개념 없음)
  db.exec(`
    INSERT OR IGNORE INTO menu_permissions (menu_key, role, can_access, can_write, can_approve) VALUES
      ('reports','admin',1,0,0),
      ('reports','team',1,0,0),
      ('reports','viewer',1,0,0);
  `);

  // 유령 메뉴 권한 정리 — 사이드바에서 내려간 portmap/topology 행 제거(권한관리 화면과 실제 메뉴 일치)
  db.exec(`DELETE FROM menu_permissions WHERE menu_key IN ('portmap','topology');`);

  // audit_logs entity_type CHECK 확장: inventory_audit / sub_asset 편입 (기존 DB 재빌드)
  // append-only 트리거는 테이블과 함께 드롭되며, initSchema 말미에서 매 부팅 재생성된다.
  {
    const alDdl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_logs'").get() as any;
    if (alDdl?.sql && !alDdl.sql.includes("'sub_asset'")) {
      db.pragma("foreign_keys = OFF");
      db.transaction(() => {
        db.exec(`
          CREATE TABLE audit_logs_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL DEFAULT 'asset' CHECK(entity_type IN ('asset','rack','location','frame','contract','movement','maintenance','inventory_audit','sub_asset')),
            entity_id INTEGER,
            entity_name TEXT DEFAULT '',
            action TEXT NOT NULL CHECK(action IN ('create','update','delete')),
            changed_by TEXT DEFAULT '',
            changed_fields TEXT DEFAULT '[]',
            old_values TEXT DEFAULT '{}',
            new_values TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now','localtime'))
          );
          INSERT INTO audit_logs_new SELECT * FROM audit_logs;
          DROP TABLE audit_logs;
          ALTER TABLE audit_logs_new RENAME TO audit_logs;
          CREATE INDEX IF NOT EXISTS idx_audit_logs ON audit_logs(entity_type, entity_id);
          CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
        `);
      })();
      db.pragma("foreign_keys = ON");
      assertNoFkViolations(db, "audit_logs CHECK 확장");
    }
  }

  // inventory_audit_checks: 부속자산(sub_asset_id) 대상 확장 (기존 DB 재빌드, 기록 보존)
  {
    const icDdl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='inventory_audit_checks'").get() as any;
    if (icDdl?.sql && !icDdl.sql.includes("sub_asset_id")) {
      db.pragma("foreign_keys = OFF");
      db.transaction(() => {
        db.exec(`
          CREATE TABLE inventory_audit_checks_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            audit_id INTEGER NOT NULL REFERENCES inventory_audits(id) ON DELETE CASCADE,
            asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
            sub_asset_id INTEGER REFERENCES sub_assets(id) ON DELETE CASCADE,
            result TEXT NOT NULL DEFAULT 'confirmed' CHECK(result IN ('confirmed','missing','moved','disposed')),
            note TEXT DEFAULT '',
            checked_by TEXT DEFAULT '',
            checked_at TEXT DEFAULT (datetime('now','localtime')),
            CHECK((asset_id IS NULL) != (sub_asset_id IS NULL)),
            UNIQUE(audit_id, asset_id),
            UNIQUE(audit_id, sub_asset_id)
          );
          INSERT INTO inventory_audit_checks_new (id, audit_id, asset_id, sub_asset_id, result, note, checked_by, checked_at)
            SELECT id, audit_id, asset_id, NULL, result, note, checked_by, checked_at FROM inventory_audit_checks;
          DROP TABLE inventory_audit_checks;
          ALTER TABLE inventory_audit_checks_new RENAME TO inventory_audit_checks;
          CREATE INDEX IF NOT EXISTS idx_audit_checks_audit ON inventory_audit_checks(audit_id);
          CREATE INDEX IF NOT EXISTS idx_audit_checks_asset ON inventory_audit_checks(asset_id);
          CREATE INDEX IF NOT EXISTS idx_audit_checks_sub ON inventory_audit_checks(sub_asset_id);
        `);
      })();
      db.pragma("foreign_keys = ON");
      assertNoFkViolations(db, "inventory_audit_checks 부속 확장");
    }
  }
  // assets: 'vm' 유형 + 망구분/CIA 도입 (CHECK 제약 변경 → 테이블 재생성)
  const assetsDdl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='assets'").get() as any;
  if (assetsDdl?.sql && !assetsDdl.sql.includes("'vm'")) {
    db.pragma("foreign_keys = OFF");
    db.pragma("legacy_alter_table = ON");
    db.transaction(() => {
      db.exec(`
        CREATE TABLE assets_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          asset_type TEXT NOT NULL,
          asset_name TEXT NOT NULL,
          manufacturer TEXT DEFAULT '',
          model TEXT DEFAULT '',
          serial_number TEXT DEFAULT '',
          ip_address TEXT DEFAULT '',
          asset_tag TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','maintenance','standby','retired')),
          network_zone TEXT DEFAULT '',
          purchase_date TEXT DEFAULT '',
          warranty_date TEXT DEFAULT '',
          eos_date TEXT DEFAULT '',
          description TEXT DEFAULT '',
          os TEXT DEFAULT '',
          access_ip TEXT DEFAULT '',
          user_name TEXT DEFAULT '',
          admin_name TEXT DEFAULT '',
          department TEXT DEFAULT '',
          cia_c INTEGER,
          cia_i INTEGER,
          cia_a INTEGER,
          cia_total INTEGER GENERATED ALWAYS AS (CASE WHEN cia_c IS NULL OR cia_i IS NULL OR cia_a IS NULL THEN NULL ELSE cia_c+cia_i+cia_a END) VIRTUAL,
          cia_grade TEXT GENERATED ALWAYS AS (CASE WHEN cia_c IS NULL OR cia_i IS NULL OR cia_a IS NULL THEN '' WHEN cia_c+cia_i+cia_a>=7 THEN 'H' WHEN cia_c+cia_i+cia_a>=5 THEN 'M' ELSE 'L' END) VIRTUAL,
          rack_id INTEGER REFERENCES racks(id) ON DELETE SET NULL,
          rack_unit_start INTEGER,
          rack_unit_size INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );
        INSERT INTO assets_new (id,asset_type,asset_name,manufacturer,model,serial_number,ip_address,asset_tag,status,purchase_date,warranty_date,eos_date,description,os,access_ip,user_name,admin_name,department,rack_id,rack_unit_start,rack_unit_size,created_at,updated_at)
          SELECT id,asset_type,asset_name,manufacturer,model,serial_number,ip_address,asset_tag,CASE status WHEN 'inactive' THEN 'standby' WHEN 'decommissioned' THEN 'retired' WHEN 'eos' THEN 'retired' ELSE status END,purchase_date,warranty_date,eos_date,description,os,access_ip,user_name,admin_name,department,rack_id,rack_unit_start,rack_unit_size,created_at,updated_at FROM assets;
        DROP TABLE assets;
        ALTER TABLE assets_new RENAME TO assets;
        CREATE INDEX IF NOT EXISTS idx_assets_rack ON assets(rack_id);
        CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);
      `);
    })();
    db.pragma("legacy_alter_table = OFF");
    db.pragma("foreign_keys = ON");
    assertNoFkViolations(db, "migration rebuild");
  }

  // ── P1 스키마 마이그레이션 (ADR-009/011) ──

  // audit_logs 무결성 정책(불변): append-only.
  //  - audit_logs 행은 생성 후 UPDATE/DELETE 하지 않는다(보존기간 만료 prune 제외).
  //  - 실제 강제는 후속 단계에서 앱 계층(레포지토리/서비스)에서 수행한다.
  //    여기서는 문서화된 불변식만 명시한다.

  // 4. users: team_id 추가 + role CHECK ('admin','user','viewer') → ('admin','team','viewer')
  {
    const uCols = db.prepare("PRAGMA table_info(users)").all() as any[];
    const uColNames = new Set(uCols.map((c: any) => c.name));
    if (!uColNames.has("team_id")) {
      db.exec(`ALTER TABLE users ADD COLUMN team_id INTEGER REFERENCES teams(id)`);
    }
    // 세션 폐기용 토큰 버전 (auth.ts getSession이 대조) — 비밀번호 변경/강제 로그아웃 시 +1
    if (!uColNames.has("token_version")) {
      db.exec(`ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0`);
    }
    // 사용자별 IP 접근제어 — 허용 IP/CIDR 목록(콤마구분). 비면 제한 없음.
    if (!uColNames.has("allowed_ips")) {
      db.exec(`ALTER TABLE users ADD COLUMN allowed_ips TEXT DEFAULT ''`);
    }
    // 관리자 비밀번호 초기화 → 첫 로그인 시 비밀번호 변경 강제(공존시스템 규약과 동일).
    if (!uColNames.has("must_change_password")) {
      db.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0`);
    }
    const usersDdl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as any;
    if (usersDdl?.sql && usersDdl.sql.includes("'user'")) {
      db.pragma("foreign_keys = OFF");
      db.pragma("legacy_alter_table = ON");
      db.transaction(() => {
        db.exec(`
          CREATE TABLE users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name TEXT DEFAULT '',
            role TEXT NOT NULL DEFAULT 'team' CHECK(role IN ('admin','team','viewer')),
            is_active INTEGER DEFAULT 1,
            token_version INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            team_id INTEGER REFERENCES teams(id)
          );
          INSERT INTO users_new (id,username,password_hash,display_name,role,is_active,token_version,created_at,team_id)
            SELECT id,username,password_hash,display_name,
                   CASE role WHEN 'user' THEN 'team' ELSE role END,
                   is_active,COALESCE(token_version,0),created_at,team_id FROM users;
          DROP TABLE users;
          ALTER TABLE users_new RENAME TO users;
        `);
      })();
      db.pragma("legacy_alter_table = OFF");
      db.pragma("foreign_keys = ON");
      assertNoFkViolations(db, "migration rebuild");
    }
  }

  // 5. assets: team_id 추가 + status CHECK → ('active','maintenance','standby','retired')
  //    department는 삭제하지 않음(ADR-009: team_id가 소유권의 권위, department는 읽기전용 레거시 음영 컬럼)
  {
    const aCols = db.prepare("PRAGMA table_info(assets)").all() as any[];
    const aColNames = new Set(aCols.map((c: any) => c.name));
    if (!aColNames.has("team_id")) {
      db.exec(`ALTER TABLE assets ADD COLUMN team_id INTEGER REFERENCES teams(id)`);
    }
    const aDdl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='assets'").get() as any;
    if (aDdl?.sql && !aDdl.sql.includes("'standby'")) {
      db.pragma("foreign_keys = OFF");
      db.pragma("legacy_alter_table = ON");
      db.transaction(() => {
        db.exec(`
          CREATE TABLE assets_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_type TEXT NOT NULL,
            asset_name TEXT NOT NULL,
            manufacturer TEXT DEFAULT '',
            model TEXT DEFAULT '',
            serial_number TEXT DEFAULT '',
            ip_address TEXT DEFAULT '',
            asset_tag TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','maintenance','standby','retired')),
            network_zone TEXT DEFAULT '',
            purchase_date TEXT DEFAULT '',
            warranty_date TEXT DEFAULT '',
            eos_date TEXT DEFAULT '',
            description TEXT DEFAULT '',
            os TEXT DEFAULT '',
            access_ip TEXT DEFAULT '',
            user_name TEXT DEFAULT '',
            admin_name TEXT DEFAULT '',
            department TEXT DEFAULT '',
            team_id INTEGER REFERENCES teams(id),
            cia_c INTEGER,
            cia_i INTEGER,
            cia_a INTEGER,
            cia_total INTEGER GENERATED ALWAYS AS (CASE WHEN cia_c IS NULL OR cia_i IS NULL OR cia_a IS NULL THEN NULL ELSE cia_c+cia_i+cia_a END) VIRTUAL,
            cia_grade TEXT GENERATED ALWAYS AS (CASE WHEN cia_c IS NULL OR cia_i IS NULL OR cia_a IS NULL THEN '' WHEN cia_c+cia_i+cia_a>=7 THEN 'H' WHEN cia_c+cia_i+cia_a>=5 THEN 'M' ELSE 'L' END) VIRTUAL,
            rack_id INTEGER REFERENCES racks(id) ON DELETE SET NULL,
            rack_unit_start INTEGER,
            rack_unit_size INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
          );
          INSERT INTO assets_new (id,asset_type,asset_name,manufacturer,model,serial_number,ip_address,asset_tag,status,network_zone,purchase_date,warranty_date,eos_date,description,os,access_ip,user_name,admin_name,department,team_id,cia_c,cia_i,cia_a,rack_id,rack_unit_start,rack_unit_size,created_at,updated_at)
            SELECT id,asset_type,asset_name,manufacturer,model,serial_number,ip_address,asset_tag,
                   CASE status WHEN 'inactive' THEN 'standby' WHEN 'decommissioned' THEN 'retired' WHEN 'eos' THEN 'retired' ELSE status END,
                   network_zone,purchase_date,warranty_date,eos_date,description,os,access_ip,user_name,admin_name,department,team_id,cia_c,cia_i,cia_a,rack_id,rack_unit_start,rack_unit_size,created_at,updated_at FROM assets;
          DROP TABLE assets;
          ALTER TABLE assets_new RENAME TO assets;
          CREATE INDEX IF NOT EXISTS idx_assets_rack ON assets(rack_id);
          CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);
        `);
      })();
      db.pragma("legacy_alter_table = OFF");
      db.pragma("foreign_keys = ON");
      assertNoFkViolations(db, "migration rebuild");
    }
    // idx_assets_team: team_id 컬럼 보장 후 생성
    db.exec(`CREATE INDEX IF NOT EXISTS idx_assets_team ON assets(team_id)`);
    // rack_side(반폭 장비 L/R) — 재빌드 이후 시점에 추가해야 재빌드가 컬럼을 탈락시키지 않는다 (R2 token_version 사고 재발 방지)
    {
      const aCols2 = new Set((db.prepare("PRAGMA table_info(assets)").all() as any[]).map((c: any) => c.name));
      if (!aCols2.has("rack_side")) {
        db.exec(`ALTER TABLE assets ADD COLUMN rack_side TEXT CHECK(rack_side IN ('L','R'))`);
      }
    }
  }

  // 5-3. asset_movements: 반입/반출 확인서용 물리정보 컬럼 보강
  {
    const mvCols = new Set((db.prepare("PRAGMA table_info(asset_movements)").all() as any[]).map((c: any) => c.name));
    const addCols: [string, string][] = [
      ["model", "TEXT DEFAULT ''"],
      ["size_u", "TEXT DEFAULT ''"],
      ["manufacturer", "TEXT DEFAULT ''"],
      ["rack_position", "TEXT DEFAULT ''"],
      ["power_watts", "TEXT DEFAULT ''"],
      ["power_redundant", "TEXT DEFAULT ''"],
    ];
    for (const [name, def] of addCols) {
      if (!mvCols.has(name)) db.exec(`ALTER TABLE asset_movements ADD COLUMN ${name} ${def}`);
    }
  }
  // 5-2. maintenance_targets: 신규 테이블/인덱스 보강
  {
    db.exec(`
      CREATE TABLE IF NOT EXISTS maintenance_targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
        asset_name TEXT DEFAULT '',
        system_name TEXT DEFAULT '',
        category TEXT DEFAULT '',
        asset_type_label TEXT DEFAULT '',
        resource_name TEXT DEFAULT '',
        quantity INTEGER DEFAULT 1,
        manufacturer TEXT DEFAULT '',
        host_name TEXT DEFAULT '',
        purpose TEXT DEFAULT '',
        location_text TEXT DEFAULT '',
        rack_position TEXT DEFAULT '',
        asset_code TEXT DEFAULT '',
        owner_department TEXT DEFAULT '',
        owner_user TEXT DEFAULT '',
        acquisition_date TEXT DEFAULT '',
        acquisition_amount TEXT DEFAULT '',
        maintenance_start TEXT DEFAULT '',
        maintenance_end TEXT DEFAULT '',
        maintenance_months INTEGER DEFAULT 0,
        business_impact TEXT DEFAULT '',
        data_importance TEXT DEFAULT '',
        user_traffic TEXT DEFAULT '',
        hardware_score TEXT DEFAULT '',
        maintenance_difficulty TEXT DEFAULT '',
        maintenance_scope TEXT DEFAULT '',
        score_total TEXT DEFAULT '',
        grade TEXT DEFAULT '',
        rate TEXT DEFAULT '',
        estimated_amount_calc TEXT DEFAULT '',
        estimated_amount_input TEXT DEFAULT '',
        evidence_note TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_by TEXT DEFAULT '',
        updated_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_maintenance_targets_asset ON maintenance_targets(asset_id);
      CREATE INDEX IF NOT EXISTS idx_maintenance_targets_code ON maintenance_targets(asset_code);
    `);
  }

  // 5-1. maintenance_logs: CASCADE → SET NULL + asset_name 스냅샷 (이력 보존, R3 비평 반영)
  {
    const mlDdl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='maintenance_logs'").get() as any;
    if (mlDdl?.sql && mlDdl.sql.includes("ON DELETE CASCADE")) {
      db.pragma("foreign_keys = OFF");
      db.pragma("legacy_alter_table = ON");
      db.transaction(() => {
        db.exec(`
          CREATE TABLE maintenance_logs_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
            asset_name TEXT DEFAULT '',
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
          INSERT INTO maintenance_logs_new (id,asset_id,asset_name,log_type,occurred_at,resolved_at,reported_by,handled_by,severity,symptom,action_taken,vendor_id,cost,status,notes,created_at)
            SELECT ml.id,ml.asset_id,COALESCE(a.asset_name,''),ml.log_type,ml.occurred_at,ml.resolved_at,ml.reported_by,ml.handled_by,ml.severity,ml.symptom,ml.action_taken,ml.vendor_id,ml.cost,ml.status,ml.notes,ml.created_at
            FROM maintenance_logs ml LEFT JOIN assets a ON ml.asset_id = a.id;
          DROP TABLE maintenance_logs;
          ALTER TABLE maintenance_logs_new RENAME TO maintenance_logs;
          CREATE INDEX IF NOT EXISTS idx_maintenance_asset ON maintenance_logs(asset_id);
        `);
      })();
      db.pragma("legacy_alter_table = OFF");
      db.pragma("foreign_keys = ON");
      assertNoFkViolations(db, "maintenance_logs rebuild");
    }
    // 기존 SET NULL DB에 asset_name 컬럼만 없는 경우
    const mlCols = new Set((db.prepare("PRAGMA table_info(maintenance_logs)").all() as any[]).map((c: any) => c.name));
    if (!mlCols.has("asset_name")) {
      db.exec(`ALTER TABLE maintenance_logs ADD COLUMN asset_name TEXT DEFAULT ''`);
      db.exec(`UPDATE maintenance_logs SET asset_name = COALESCE((SELECT asset_name FROM assets WHERE assets.id = maintenance_logs.asset_id), '')`);
    }
  }

  // 6. asset_ips: ip_type CHECK에 'extra' 추가
  {
    const ipDdl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='asset_ips'").get() as any;
    if (ipDdl?.sql && !ipDdl.sql.includes("'extra'")) {
      db.pragma("foreign_keys = OFF");
      db.pragma("legacy_alter_table = ON");
      db.transaction(() => {
        db.exec(`
          CREATE TABLE asset_ips_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            ip_address TEXT NOT NULL,
            ip_type TEXT DEFAULT 'service' CHECK(ip_type IN ('management','service','backup','vip','other','extra')),
            interface_name TEXT DEFAULT '',
            subnet_mask TEXT DEFAULT '',
            gateway TEXT DEFAULT '',
            is_primary INTEGER DEFAULT 0,
            description TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
          );
          INSERT INTO asset_ips_new (id,asset_id,ip_address,ip_type,interface_name,subnet_mask,gateway,is_primary,description,created_at)
            SELECT id,asset_id,ip_address,ip_type,interface_name,subnet_mask,gateway,is_primary,description,created_at FROM asset_ips;
          DROP TABLE asset_ips;
          ALTER TABLE asset_ips_new RENAME TO asset_ips;
          CREATE INDEX IF NOT EXISTS idx_asset_ips_asset ON asset_ips(asset_id);
          CREATE INDEX IF NOT EXISTS idx_asset_ips_ip ON asset_ips(ip_address);
        `);
      })();
      db.pragma("legacy_alter_table = OFF");
      db.pragma("foreign_keys = ON");
      assertNoFkViolations(db, "migration rebuild");
    }
  }

  // 7. menu_permissions: role CHECK ('admin','user','viewer') → ('admin','team','viewer')
  {
    const mpDdl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='menu_permissions'").get() as any;
    if (mpDdl?.sql && mpDdl.sql.includes("'user'")) {
      db.pragma("foreign_keys = OFF");
      db.pragma("legacy_alter_table = ON");
      db.transaction(() => {
        db.exec(`
          CREATE TABLE menu_permissions_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            menu_key TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin','team','viewer')),
            can_access INTEGER DEFAULT 1,
            can_write INTEGER DEFAULT 0,
            can_approve INTEGER DEFAULT 0,
            UNIQUE(menu_key, role)
          );
          INSERT INTO menu_permissions_new (id,menu_key,role,can_access,can_write,can_approve)
            SELECT id,menu_key,
                   CASE role WHEN 'user' THEN 'team' ELSE role END,
                   can_access,can_write,can_approve FROM menu_permissions;
          DROP TABLE menu_permissions;
          ALTER TABLE menu_permissions_new RENAME TO menu_permissions;
          CREATE INDEX IF NOT EXISTS idx_menu_perms ON menu_permissions(role, menu_key);
        `);
      })();
      db.pragma("legacy_alter_table = OFF");
      db.pragma("foreign_keys = ON");
      assertNoFkViolations(db, "migration rebuild");
    }
  }

  // asset_type / network_zone 고정 enum(CHECK) 해제 (ADR-011 확장): 독립 부서가 자기 유형·망구분을
  // 직접 입력할 수 있도록 두 CHECK를 제거한다. 기존 DB만 1회 재빌드(데이터·생성컬럼 보존). 신규 DB는
  // 기반 DDL이 이미 CHECK 없음 → 재빌드 안 함. status/rack_side CHECK는 유지(운영 enum).
  {
    const aDdl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='assets'").get() as any;
    const ddlSql: string = aDdl?.sql || "";
    if (/CHECK\s*\(\s*asset_type\s+IN/i.test(ddlSql) || /CHECK\s*\(\s*network_zone\s+IN/i.test(ddlSql)) {
      // 비생성 컬럼만 복사 (cia_total/cia_grade 등 GENERATED 컬럼 제외)
      const copyCols = (db.prepare("PRAGMA table_xinfo(assets)").all() as any[])
        .filter((c: any) => Number(c.hidden) === 0)
        .map((c: any) => c.name);
      const colList = copyCols.join(",");
      // 현재 DDL에서 두 CHECK 절만 제거 + 테이블명을 assets_new 로 치환 (나머지 컬럼/FK/생성컬럼 원형 보존)
      const newDdl = ddlSql
        .replace(/\s*CHECK\s*\(\s*asset_type\s+IN\s*\([^)]*\)\s*\)/i, "")
        .replace(/\s*CHECK\s*\(\s*network_zone\s+IN\s*\([^)]*\)\s*\)/i, "")
        .replace(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?"?assets"?/i, "CREATE TABLE assets_new");
      db.pragma("foreign_keys = OFF");
      db.pragma("legacy_alter_table = ON");
      db.transaction(() => {
        db.exec(newDdl);
        db.exec(`INSERT INTO assets_new (${colList}) SELECT ${colList} FROM assets;`);
        db.exec(`DROP TABLE assets; ALTER TABLE assets_new RENAME TO assets;`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_assets_rack ON assets(rack_id);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_assets_team ON assets(team_id);`);
      })();
      db.pragma("legacy_alter_table = OFF");
      db.pragma("foreign_keys = ON");
      assertNoFkViolations(db, "asset_type/network_zone CHECK \ud574\uc81c \uc7ac\ube4c\ub4dc");
    }
  }

  // 정리 대기열(클린업 큐) 뷰: 보완이 필요한 자산 + 임포트 이슈 건수
  db.exec(`
    DROP VIEW IF EXISTS v_cleanup_queue;
    CREATE VIEW v_cleanup_queue AS
      SELECT
        a.id AS asset_id,
        a.asset_name,
        a.asset_type,
        CASE WHEN a.ip_address='' AND NOT EXISTS (SELECT 1 FROM asset_ips ai WHERE ai.asset_id=a.id) THEN 1 ELSE 0 END AS missing_ip,
        CASE WHEN a.asset_type IN ('server','vm') AND a.os='' THEN 1 ELSE 0 END AS missing_os,
        CASE WHEN a.admin_name='' THEN 1 ELSE 0 END AS missing_admin,
        CASE WHEN a.rack_id IS NULL THEN 1 ELSE 0 END AS missing_rack,
        (SELECT COUNT(*) FROM import_issue ii WHERE ii.asset_id=a.id AND ii.status='open') AS import_issue_count
      FROM assets a
      WHERE (a.ip_address='' AND NOT EXISTS (SELECT 1 FROM asset_ips ai WHERE ai.asset_id=a.id))
         OR (a.asset_type IN ('server','vm') AND a.os='')
         OR a.admin_name=''
         OR a.rack_id IS NULL;
  `);

  // audit_logs append-only 강제 (AC-1/19): UPDATE 전면 금지(불변), DELETE는 1년 초과 보존 프루닝만 허용.
  db.exec(`
    DROP TRIGGER IF EXISTS trg_audit_logs_no_update;
    CREATE TRIGGER trg_audit_logs_no_update
      BEFORE UPDATE ON audit_logs
      BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only (no update)'); END;

    DROP TRIGGER IF EXISTS trg_audit_logs_no_delete;
    CREATE TRIGGER trg_audit_logs_no_delete
      BEFORE DELETE ON audit_logs
      WHEN OLD.created_at >= datetime('now','-365 days','localtime')
      BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only (delete allowed only for >1yr retention prune)'); END;

    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
  `);
}

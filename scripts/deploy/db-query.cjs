// ── 운영 DB 점검 (읽기 전용) ──
// 폐쇄망 서버에는 sqlite3 CLI 가 없다. 번들 better-sqlite3 로 data.db 를 **읽기 전용**으로 열어
// 운영 점검 쿼리를 실행한다. readonly 연결 + query_only 라서 INSERT/UPDATE/DELETE/DDL 은 실패한다.
// 서비스 기동 중에도 안전하다(WAL — 쓰기와 동시 읽기 가능).
//
// 사용:
//   sudo -u asset /opt/asset-inventory/node/bin/node /opt/asset-inventory/scripts/deploy/db-query.cjs <점검명>
//   sudo -u asset /opt/asset-inventory/node/bin/node /opt/asset-inventory/scripts/deploy/db-query.cjs sql "SELECT ..."
//   점검명 없이 실행하면 목록을 출력한다. 정본 설명: docs/관리자매뉴얼.md §7 "DB 점검(SQL)".
// 환경변수: APP_DIR(기본 /opt/asset-inventory), ASSET_DB_PATH(기본 $APP_DIR/data.db)
"use strict";
const path = require("node:path");

const APP = process.env.APP_DIR || "/opt/asset-inventory";
const DB_PATH = process.env.ASSET_DB_PATH || path.join(APP, "data.db");

const CHECKS = {
  summary: {
    desc: "스키마 버전 + 주요 테이블 건수 (업그레이드 전후 비교)",
    sql: [
      "PRAGMA user_version",
      `SELECT 'assets' AS tbl, COUNT(*) AS cnt FROM assets
       UNION ALL SELECT 'sub_assets', COUNT(*) FROM sub_assets
       UNION ALL SELECT 'asset_ips', COUNT(*) FROM asset_ips
       UNION ALL SELECT 'racks', COUNT(*) FROM racks
       UNION ALL SELECT 'locations', COUNT(*) FROM locations
       UNION ALL SELECT 'dist_frames', COUNT(*) FROM dist_frames
       UNION ALL SELECT 'contracts', COUNT(*) FROM contracts
       UNION ALL SELECT 'users', COUNT(*) FROM users
       UNION ALL SELECT 'teams', COUNT(*) FROM teams
       UNION ALL SELECT 'menu_permissions', COUNT(*) FROM menu_permissions
       UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
       UNION ALL SELECT 'access_logs', COUNT(*) FROM access_logs
       UNION ALL SELECT 'feedback', COUNT(*) FROM feedback`,
    ],
  },
  integrity: {
    desc: "무결성 · 외래키 위반 · WAL 모드 (정상: ok / 0건 / wal)",
    sql: ["PRAGMA integrity_check", "PRAGMA foreign_key_check", "PRAGMA journal_mode"],
  },
  schema: {
    desc: "필수 컬럼 누락 검사 (정상: 0건 — 행이 나오면 서비스 재시작으로 마이그레이션 재실행)",
    sql: [
      `SELECT r.tbl, r.col AS missing_column FROM (
         SELECT 'assets' tbl, 'import_batch_id' col UNION ALL SELECT 'assets','team_id' UNION ALL SELECT 'assets','network_zone'
         UNION ALL SELECT 'assets','rack_side' UNION ALL SELECT 'assets','verified_at' UNION ALL SELECT 'assets','cia_c'
         UNION ALL SELECT 'users','token_version' UNION ALL SELECT 'users','allowed_ips' UNION ALL SELECT 'users','must_change_password'
         UNION ALL SELECT 'users','totp_enabled' UNION ALL SELECT 'users','team_id'
         UNION ALL SELECT 'sub_assets','team_id' UNION ALL SELECT 'import_issue','status'
       ) r WHERE NOT EXISTS (SELECT 1 FROM pragma_table_xinfo(r.tbl) p WHERE p.name = r.col)`,
    ],
  },
  users: {
    desc: "계정 목록 — 역할·팀·활성·강제변경·2단계인증·허용IP",
    sql: [
      `SELECT u.id, u.username, u.role, COALESCE(t.team_name,'') AS team, u.is_active AS active,
              u.must_change_password AS must_change, u.totp_enabled AS mfa,
              COALESCE(u.allowed_ips,'') AS allowed_ips, u.created_at
       FROM users u LEFT JOIN teams t ON t.id = u.team_id ORDER BY u.role, u.username`,
    ],
  },
  admins: {
    desc: "활성 총괄(admin) 수와 2단계 인증 등록 여부 (활성 admin 0명이면 비상)",
    sql: [
      `SELECT username, totp_enabled AS mfa, must_change_password AS must_change
       FROM users WHERE role='admin' AND is_active=1 ORDER BY username`,
    ],
  },
  mfa: {
    desc: "2단계 인증 등록 현황 (역할별) + 백업코드 잔량 적은 계정",
    sql: [
      `SELECT role, COUNT(*) AS total, SUM(totp_enabled) AS mfa_on FROM users WHERE is_active=1 GROUP BY role`,
      `SELECT username, json_array_length(COALESCE(NULLIF(backup_codes,''),'[]')) AS backup_left
       FROM users WHERE totp_enabled=1 AND json_array_length(COALESCE(NULLIF(backup_codes,''),'[]')) < 3`,
    ],
  },
  lockouts: {
    desc: "현재 로그인/2단계 잠금 (u:계정 · ip:IP · m:2단계코드)",
    sql: [
      `SELECT key, fail_count, datetime(first_fail_at/1000,'unixepoch','localtime') AS first_fail,
              datetime(locked_until/1000,'unixepoch','localtime') AS locked_until,
              CASE WHEN locked_until > CAST(strftime('%s','now') AS INTEGER)*1000 THEN 'LOCKED' ELSE '' END AS state
       FROM login_attempts ORDER BY locked_until DESC`,
    ],
  },
  logins: {
    desc: "최근 7일 로그인 실패 — 계정·IP·사유별 (무차별 대입·허용IP 거부 추적)",
    sql: [
      `SELECT username, ip, failure_reason, COUNT(*) AS cnt, MAX(created_at) AS last_at
       FROM access_logs WHERE action='fail' AND created_at >= datetime('now','localtime','-7 days')
       GROUP BY username, ip, failure_reason ORDER BY cnt DESC LIMIT 50`,
    ],
  },
  "recent-logins": {
    desc: "최근 로그인/로그아웃/실패 50건",
    sql: [
      `SELECT created_at, action, username, ip, result_code, failure_reason
       FROM access_logs ORDER BY id DESC LIMIT 50`,
    ],
  },
  "audit-recent": {
    desc: "최근 데이터 변경 감사로그 50건",
    sql: [
      `SELECT created_at, entity_type, action, entity_name, changed_by, changed_fields
       FROM audit_logs ORDER BY id DESC LIMIT 50`,
    ],
  },
  "audit-admin": {
    desc: "최근 30일 관리자 행위 — 계정·팀·권한 변경 (보안 감사)",
    sql: [
      `SELECT created_at, entity_type, action, entity_name, changed_by, changed_fields
       FROM audit_logs WHERE entity_type IN ('user','team','permission')
         AND created_at >= datetime('now','localtime','-30 days')
       ORDER BY id DESC LIMIT 100`,
    ],
  },
  retention: {
    desc: "로그 보존 범위 — 가장 오래된/최근 기록 (프루닝 타이머 동작 확인: 오래된 값이 ~1년 이내)",
    sql: [
      `SELECT 'audit_logs' AS tbl, MIN(created_at) AS oldest, MAX(created_at) AS newest, COUNT(*) AS cnt FROM audit_logs
       UNION ALL SELECT 'access_logs', MIN(created_at), MAX(created_at), COUNT(*) FROM access_logs`,
    ],
  },
  quality: {
    desc: "데이터 품질 — 미배정 자산·정리큐 미조치·랙 미배치·대표 IP 중복(사설 IP 포함, 판단은 사람이)",
    sql: [
      `SELECT 'team 미배정 자산' AS item, COUNT(*) AS cnt FROM assets WHERE team_id IS NULL AND status!='retired'
       UNION ALL SELECT 'team 미배정 부속', COUNT(*) FROM sub_assets WHERE team_id IS NULL AND status='active'
       UNION ALL SELECT '정리큐 미조치', COUNT(*) FROM import_issue WHERE status='open'
       UNION ALL SELECT '랙 미배치(운용중)', COUNT(*) FROM assets WHERE rack_id IS NULL AND status='active'
       UNION ALL SELECT 'IP 없는 자산(운용중)', COUNT(*) FROM assets WHERE COALESCE(ip_address,'')='' AND status='active'`,
      `SELECT ip_address, COUNT(*) AS cnt, GROUP_CONCAT(asset_name, ' | ') AS assets
       FROM assets WHERE COALESCE(ip_address,'')!='' AND status!='retired'
       GROUP BY ip_address HAVING COUNT(*) > 1 ORDER BY cnt DESC LIMIT 30`,
    ],
  },
  "import-issues": {
    desc: "정리큐(임포트 이상값) 미조치 — 유형별 건수 + 최근 30건",
    sql: [
      `SELECT issue_type, COUNT(*) AS cnt FROM import_issue WHERE status='open' GROUP BY issue_type ORDER BY cnt DESC`,
      `SELECT i.id, i.batch_id, i.issue_type, COALESCE(a.asset_name,'') AS asset, i.raw_value, i.note, i.created_at
       FROM import_issue i LEFT JOIN assets a ON a.id = i.asset_id
       WHERE i.status='open' ORDER BY i.id DESC LIMIT 30`,
    ],
  },
  "bad-dates": {
    desc: "YYYY-MM-DD 가 아닌 날짜 (마이그레이션이 해석 못 한 값 — 화면에서 수기 정정)",
    sql: [
      `SELECT id, asset_name, 'purchase_date' AS col, purchase_date AS value FROM assets
         WHERE COALESCE(purchase_date,'')!='' AND purchase_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
       UNION ALL SELECT id, asset_name, 'warranty_date', warranty_date FROM assets
         WHERE COALESCE(warranty_date,'')!='' AND warranty_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
       UNION ALL SELECT id, asset_name, 'eos_date', eos_date FROM assets
         WHERE COALESCE(eos_date,'')!='' AND eos_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
       LIMIT 100`,
    ],
  },
  freshness: {
    desc: "현행화율 — 팀별 90일 내 현행 확인 비율 (운용·대기 자산)",
    sql: [
      `SELECT COALESCE(t.team_name,'(미배정)') AS team, COUNT(*) AS assets,
              SUM(CASE WHEN COALESCE(a.verified_at,'') >= datetime('now','localtime','-90 days') THEN 1 ELSE 0 END) AS verified_90d,
              ROUND(100.0 * SUM(CASE WHEN COALESCE(a.verified_at,'') >= datetime('now','localtime','-90 days') THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct
       FROM assets a LEFT JOIN teams t ON t.id = a.team_id
       WHERE a.status IN ('active','standby','maintenance')
       GROUP BY a.team_id ORDER BY pct`,
    ],
  },
  teams: {
    desc: "팀별 소유 현황 — 자산·부속·사용자 수",
    sql: [
      `SELECT t.id, t.team_name,
              (SELECT COUNT(*) FROM assets a WHERE a.team_id = t.id) AS assets,
              (SELECT COUNT(*) FROM sub_assets s WHERE s.team_id = t.id) AS sub_assets,
              (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id AND u.is_active = 1) AS users
       FROM teams t ORDER BY t.team_name`,
    ],
  },
  permissions: {
    desc: "메뉴 권한 매트릭스 (역할 × 메뉴 — 접근/쓰기/승인)",
    sql: [
      `SELECT role, menu_key, can_access AS access, can_write AS write, can_approve AS approve
       FROM menu_permissions ORDER BY role, menu_key`,
    ],
  },
  contracts: {
    desc: "90일 내 만료 예정(또는 이미 만료됐는데 active) 계약",
    sql: [
      `SELECT c.id, c.contract_name, COALESCE(v.vendor_name,'') AS vendor, c.end_date, c.auto_renew
       FROM contracts c LEFT JOIN vendors v ON v.id = c.vendor_id
       WHERE c.status = 'active' AND COALESCE(c.end_date,'') != '' AND c.end_date <= date('now','localtime','+90 days')
       ORDER BY c.end_date`,
    ],
  },
  feedback: {
    desc: "개선의견 처리 현황 + 미처리 공감 상위",
    sql: [
      `SELECT status, COUNT(*) AS cnt FROM feedback GROUP BY status`,
      `SELECT f.id, f.category, f.title, f.created_by_name, f.created_at,
              (SELECT COUNT(*) FROM feedback_votes v WHERE v.feedback_id = f.id) AS votes
       FROM feedback f WHERE f.status='open' ORDER BY votes DESC, f.id DESC LIMIT 20`,
    ],
  },
  restored: {
    desc: "재기동 유실 복구 내역 (restore-lost-fields.cjs — 업그레이드 7-1 단계) — 필드별 건수 + 최근 20건",
    sql: [
      `SELECT j.key AS field, COUNT(*) AS cnt, MIN(l.created_at) AS first, MAX(l.created_at) AS last
       FROM audit_logs l, json_each(l.new_values) j
       WHERE l.changed_by = 'system:restore-lost-fields' AND j.key != '_cause' GROUP BY j.key`,
      `SELECT l.entity_id AS asset_id, l.entity_name AS asset_name, l.created_at,
              json_remove(l.new_values, '$._cause') AS restored
       FROM audit_logs l WHERE l.changed_by = 'system:restore-lost-fields' ORDER BY l.id DESC LIMIT 20`,
    ],
  },
  mail: {
    desc: "메일 릴레이 설정",
    sql: [`SELECT host, port, security, from_address, from_name, base_url, enabled, updated_at FROM mail_relay_config`],
  },
};

function loadDriver() {
  for (const p of [path.join(APP, ".next/standalone/node_modules/better-sqlite3"), path.join(APP, "node_modules/better-sqlite3")]) {
    try { return require(p); } catch { /* 다음 후보 */ }
  }
  console.error(`[db-query] better-sqlite3 로드 실패 — APP_DIR(${APP}) 확인`);
  process.exit(1);
}

function cell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/\s+/g, " ");
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

// 한글 등 전각 문자는 터미널에서 2칸 — 정렬이 깨지지 않게 표시 폭으로 패딩한다.
function width(s) {
  let w = 0;
  for (const ch of s) w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  return w;
}
const pad = (s, n) => s + " ".repeat(Math.max(0, n - width(s)));

function printRows(rows) {
  if (rows.length === 0) { console.log("  (0건)"); return; }
  const cols = Object.keys(rows[0]);
  const data = rows.map((r) => cols.map((c) => cell(r[c])));
  const w = cols.map((c, i) => Math.max(width(c), ...data.map((d) => width(d[i]))));
  console.log("  " + cols.map((c, i) => pad(c, w[i])).join("  "));
  console.log("  " + w.map((n) => "-".repeat(n)).join("  "));
  for (const d of data) console.log("  " + d.map((v, i) => pad(v, w[i])).join("  "));
  console.log(`  (${rows.length}건)`);
}

function run(db, sql) {
  const stmt = db.prepare(sql);
  if (!stmt.reader) { console.log(`  ${stmt.run().changes}`); return; }
  printRows(stmt.all());
}

function usage() {
  console.log(`사용: node db-query.cjs <점검명> | sql "<SELECT 문>"   (DB: ${DB_PATH}, 읽기 전용)\n`);
  for (const [k, v] of Object.entries(CHECKS)) console.log(`  ${k.padEnd(14)} ${v.desc}`);
  console.log(`  ${"all".padEnd(14)} 위 점검 전체 실행`);
  console.log(`  ${"sql".padEnd(14)} 임의 SELECT 실행 — 예: sql "SELECT COUNT(*) FROM assets WHERE status='active'"`);
}

const [name, ...rest] = process.argv.slice(2);
if (!name || name === "-h" || name === "--help") { usage(); process.exit(name ? 0 : 1); }

const Database = loadDriver();
let db;
try {
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
} catch (e) {
  console.error(`[db-query] DB 열기 실패: ${DB_PATH} — ${e.message}`);
  process.exit(1);
}
db.pragma("query_only = ON");

try {
  if (name === "sql") {
    const sql = rest.join(" ").trim();
    if (!sql) { console.error('[db-query] SQL 이 비었습니다: sql "SELECT ..."'); process.exit(1); }
    run(db, sql);
  } else {
    const names = name === "all" ? Object.keys(CHECKS) : [name];
    for (const n of names) {
      const c = CHECKS[n];
      if (!c) { console.error(`[db-query] 알 수 없는 점검: ${n}\n`); usage(); process.exit(1); }
      console.log(`\n== ${n} — ${c.desc}`);
      for (const sql of c.sql) run(db, sql);
    }
  }
} catch (e) {
  console.error(`[db-query] 실행 실패: ${e.message}`);
  process.exit(1);
} finally {
  db.close();
}

// P6 대시보드 정리-필요-큐/데이터품질 집계 (AC-2/13/14). 순수 모듈(프레임워크 import 없음)이라
// 대시보드 페이지와 테스트가 동일 코드를 공유한다(단일 진실원천). 모든 집계는 actor의 scopeWhere로 제한.
import type Database from "better-sqlite3";
import type { ScopeClause, Actor } from "./authz.ts";
import { scopeWhere, rackScopeWhere, locationScopeWhere } from "./authz.ts";
import type { CountRow, MovementRow, MaintenanceLogRow, ContractRow, AssetStatus } from "./db-types";
import { freshnessCaseSql } from "./freshness.ts";

export interface DupGroup {
  asset_name: string;
  c: number;
  distinct_serials: number;
  distinct_ips: number;
}
export interface RackConflict {
  rack_name: string;
  unit_range: string;
  a_name: string;
  b_name: string;
}
export interface RackOverflow {
  rack_name: string;
  asset_name: string;
  unit_range: string;
  total_units: number;
}
export interface CleanupStats {
  byTeam: { team_name: string; team_id: number | null; c: number }[];
  issueSummary: { error: number; missing_id: number; missing_os: number; dup_suspect: number; date_format: number };
  cleanupCount: number;
  cleanupQueue: {
    asset_id: number; asset_name: string; asset_type: string;
    missing_ip: number; missing_os: number; missing_admin: number; missing_rack: number;
    import_issue_count: number;
  }[];
  dupSuspect: { groups: number; assets: number; likelyDup: number; topGroups: DupGroup[] };
  rackConflicts: { conflicts: RackConflict[]; overflows: RackOverflow[] };
}

// ── 대시보드 전체 집계 (getStats에서 이관, P3) ──
export interface DashboardStats {
  totalAssets: number;
  byType: { asset_type: string; c: number }[];
  activeAssets: number;
  totalRacks: number;
  totalPorts: number;
  usedPorts: number;
  totalLocations: number;
  rackUsage: { id: number; rack_name: string; total_units: number; used_units: number }[];
  recentAssets: {
    id: number; asset_name: string; asset_type: string; status: AssetStatus;
    ip_address: string; os: string; admin_name: string; department: string; created_at: string;
  }[];
  byDepartment: { department: string; c: number }[];
  byAdmin: { admin_name: string; c: number }[];
  byOs: { os: string; c: number }[];
  byStatus: { status: string; c: number }[];
  eosWarnings: { id: number; asset_name: string; asset_type: string; eos_date: string }[];
  warrantyWarnings: { id: number; asset_name: string; asset_type: string; warranty_date: string }[];
  dataQuality: { no_ip: number | null; no_admin: number | null; no_rack: number | null; no_os: number | null };
  pendingMovements: number;
  recentMovements: (MovementRow & { asset_name: string | null })[];
  openMaintenance: number;
  recentMaintenance: (MaintenanceLogRow & { asset_name: string | null })[];
  expiringContracts: (ContractRow & { vendor_name: string | null })[];
  bringInPending: number;
  bringOutInProgress: number;
  byTeam: CleanupStats["byTeam"];
  issueSummary: CleanupStats["issueSummary"];
  cleanupCount: number;
  cleanupQueue: CleanupStats["cleanupQueue"];
  dupSuspect: CleanupStats["dupSuspect"];
  rackConflicts: CleanupStats["rackConflicts"];
  freshness: { fresh: number; aging: number; stale: number; never: number };
  byTeamFreshness: { team_id: number | null; team_name: string; total: number; fresh: number; verifiedPct: number }[];
}

/** 대시보드(src/app/page.tsx) 전체 통계. actor 스코프로 모든 집계를 제한한다. SQL은 getStats()에서 그대로 이관(동작 불변). */
export function getDashboardStats(db: Database.Database, actor: Actor | null): DashboardStats {
  const scope = scopeWhere(actor, "team_id");
  const scopeA = scopeWhere(actor, "a.team_id");
  const totalAssets = (db.prepare(`SELECT COUNT(*) as c FROM assets WHERE ${scope.sql}`).get(...scope.params) as CountRow).c;
  const byType = db.prepare(`SELECT asset_type, COUNT(*) as c FROM assets WHERE ${scope.sql} GROUP BY asset_type`).all(...scope.params) as DashboardStats["byType"];
  const activeAssets = (db.prepare(`SELECT COUNT(*) as c FROM assets WHERE status='active' AND ${scope.sql}`).get(...scope.params) as CountRow).c;
  // 랙/위치 집계도 팀 가시성 기준(하이브리드). 총괄/전체열람은 전체.
  const rackScope = rackScopeWhere(actor, "r.team_id", "r.id");
  const rackScopeC = rackScopeWhere(actor, "team_id", "id");
  const locScope = locationScopeWhere(actor, "team_id", "id");
  const totalRacks = (db.prepare(`SELECT COUNT(*) as c FROM racks WHERE ${rackScopeC.sql}`).get(...rackScopeC.params) as CountRow).c;
  const totalPorts = (db.prepare("SELECT COUNT(*) as c FROM ports").get() as CountRow).c;
  const usedPorts = (db.prepare("SELECT COUNT(*) as c FROM ports WHERE status='used'").get() as CountRow).c;
  const totalLocations = (db.prepare(`SELECT COUNT(*) as c FROM locations WHERE ${locScope.sql}`).get(...locScope.params) as CountRow).c;

  const rackUsage = db.prepare(`
    SELECT r.id, r.rack_name, r.total_units,
      COALESCE(SUM(a.rack_unit_size), 0) as used_units
    FROM racks r
    LEFT JOIN assets a ON a.rack_id = r.id AND ${scopeA.sql}
    WHERE ${rackScope.sql}
    GROUP BY r.id
  `).all(...scopeA.params, ...rackScope.params) as DashboardStats["rackUsage"];

  const recentAssets = db.prepare(`
    SELECT id, asset_name, asset_type, status, ip_address, os, admin_name, department, created_at
    FROM assets WHERE ${scope.sql} ORDER BY created_at DESC LIMIT 5
  `).all(...scope.params) as DashboardStats["recentAssets"];

  const byDepartment = db.prepare(`
    SELECT department, COUNT(*) as c FROM assets WHERE department != '' AND ${scope.sql} GROUP BY department ORDER BY c DESC
  `).all(...scope.params) as DashboardStats["byDepartment"];

  const byAdmin = db.prepare(`
    SELECT admin_name, COUNT(*) as c FROM assets WHERE admin_name != '' AND ${scope.sql} GROUP BY admin_name ORDER BY c DESC
  `).all(...scope.params) as DashboardStats["byAdmin"];

  const byOs = db.prepare(`
    SELECT os, COUNT(*) as c FROM assets WHERE os != '' AND ${scope.sql} GROUP BY os ORDER BY c DESC
  `).all(...scope.params) as DashboardStats["byOs"];

  // 상태별 분포
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as c FROM assets WHERE ${scope.sql} GROUP BY status
  `).all(...scope.params) as DashboardStats["byStatus"];

  // EoS 경고 (이미 EoS이거나 90일 이내)
  const days90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const eosWarnings = db.prepare(`
    SELECT id, asset_name, asset_type, eos_date FROM assets
    WHERE eos_date != '' AND eos_date <= ? AND ${scope.sql}
    ORDER BY eos_date
    LIMIT 10
  `).all(days90, ...scope.params) as DashboardStats["eosWarnings"];

  // 보증만료 경고
  const warrantyWarnings = db.prepare(`
    SELECT id, asset_name, asset_type, warranty_date FROM assets
    WHERE warranty_date != '' AND warranty_date <= ? AND ${scope.sql}
    ORDER BY warranty_date
    LIMIT 10
  `).all(days90, ...scope.params) as DashboardStats["warrantyWarnings"];

  // 데이터 품질
  const dataQuality = db.prepare(`
    SELECT
      SUM(CASE WHEN ip_address = '' THEN 1 ELSE 0 END) as no_ip,
      SUM(CASE WHEN admin_name = '' THEN 1 ELSE 0 END) as no_admin,
      SUM(CASE WHEN rack_id IS NULL THEN 1 ELSE 0 END) as no_rack,
      SUM(CASE WHEN os = '' THEN 1 ELSE 0 END) as no_os
    FROM assets WHERE ${scope.sql}
  `).get(...scope.params) as DashboardStats["dataQuality"];
  // 반입/반출 현황
  const pendingMovements = (db.prepare(`SELECT COUNT(*) as c FROM asset_movements m LEFT JOIN assets a ON m.asset_id = a.id WHERE m.status='requested' AND (m.asset_id IS NULL OR ${scopeA.sql})`).get(...scopeA.params) as CountRow).c;
  const recentMovements = db.prepare(
    `SELECT m.*, a.asset_name FROM asset_movements m LEFT JOIN assets a ON m.asset_id = a.id WHERE (m.asset_id IS NULL OR ${scopeA.sql}) ORDER BY m.created_at DESC LIMIT 5`
  ).all(...scopeA.params) as DashboardStats["recentMovements"];

  // 라이프사이클 흐름: 반입 진행(미완료) / 반출 진행(미완료) 건수
  const bringInPending = (db.prepare(
    `SELECT COUNT(*) as c FROM asset_movements m LEFT JOIN assets a ON m.asset_id = a.id
     WHERE m.movement_type='bring_in' AND m.status IN ('requested','approved') AND (m.asset_id IS NULL OR ${scopeA.sql})`
  ).get(...scopeA.params) as CountRow).c;
  const bringOutInProgress = (db.prepare(
    `SELECT COUNT(*) as c FROM asset_movements m LEFT JOIN assets a ON m.asset_id = a.id
     WHERE m.movement_type='bring_out' AND m.status IN ('requested','approved') AND (m.asset_id IS NULL OR ${scopeA.sql})`
  ).get(...scopeA.params) as CountRow).c;

  // 유지보수 현황
  const openMaintenance = (db.prepare(`SELECT COUNT(*) as c FROM maintenance_logs ml LEFT JOIN assets a ON ml.asset_id = a.id WHERE ml.status IN ('open','in_progress') AND (ml.asset_id IS NULL OR ${scopeA.sql})`).get(...scopeA.params) as CountRow).c;
  const recentMaintenance = db.prepare(
    `SELECT ml.*, a.asset_name FROM maintenance_logs ml LEFT JOIN assets a ON ml.asset_id = a.id WHERE (ml.asset_id IS NULL OR ${scopeA.sql}) ORDER BY ml.created_at DESC LIMIT 5`
  ).all(...scopeA.params) as DashboardStats["recentMaintenance"];

  // 계약 만료 현황
  const contractScope = scopeWhere(actor, "c.team_id");
  const expiringContracts = db.prepare(
    `SELECT c.*, v.vendor_name FROM contracts c LEFT JOIN vendors v ON c.vendor_id = v.id
     WHERE c.status = 'active' AND c.end_date != '' AND c.end_date <= ? AND ${contractScope.sql} ORDER BY c.end_date LIMIT 5`
  ).all(days90, ...contractScope.params) as DashboardStats["expiringContracts"];

  // ── P6 정리 필요 큐 / 데이터 품질 (AC-2/13/14) ──
  const { byTeam, issueSummary, cleanupCount, cleanupQueue, dupSuspect, rackConflicts } =
    computeCleanupStats(db, scope, scopeA);
  // ── 현행화 통계 (스코프 내 비폐기 자산 대상) ──
  const freshnessRow = db.prepare(`
    SELECT
      SUM(CASE WHEN ${freshnessCaseSql("verified_at")} = 'fresh' THEN 1 ELSE 0 END) as fresh,
      SUM(CASE WHEN ${freshnessCaseSql("verified_at")} = 'aging' THEN 1 ELSE 0 END) as aging,
      SUM(CASE WHEN ${freshnessCaseSql("verified_at")} = 'stale' THEN 1 ELSE 0 END) as stale,
      SUM(CASE WHEN ${freshnessCaseSql("verified_at")} = 'never' THEN 1 ELSE 0 END) as never
    FROM assets
    WHERE status != 'retired' AND ${scope.sql}
  `).get(...scope.params) as { fresh: number | null; aging: number | null; stale: number | null; never: number | null } | undefined;

  const freshness = {
    fresh: freshnessRow?.fresh ?? 0,
    aging: freshnessRow?.aging ?? 0,
    stale: freshnessRow?.stale ?? 0,
    never: freshnessRow?.never ?? 0,
  };

  const teamFreshRows = db.prepare(`
    SELECT
      a.team_id,
      COALESCE(t.team_name, '(미배정)') as team_name,
      COUNT(*) as total,
      SUM(CASE WHEN ${freshnessCaseSql("a.verified_at")} = 'fresh' THEN 1 ELSE 0 END) as fresh
    FROM assets a
    LEFT JOIN teams t ON a.team_id = t.id
    WHERE a.status != 'retired' AND ${scopeA.sql}
    GROUP BY a.team_id, t.team_name
  `).all(...scopeA.params) as { team_id: number | null; team_name: string; total: number; fresh: number }[];

  const byTeamFreshness = teamFreshRows
    .map((row) => {
      const verifiedPct = row.total > 0 ? Math.round((row.fresh / row.total) * 100 * 10) / 10 : 0;
      return {
        team_id: row.team_id,
        team_name: row.team_name,
        total: row.total,
        fresh: row.fresh,
        verifiedPct,
      };
    })
    .sort((a, b) => b.verifiedPct - a.verifiedPct || b.total - a.total);


  return {
    totalAssets, byType, activeAssets, totalRacks, totalPorts, usedPorts,
    totalLocations, rackUsage, recentAssets, byDepartment, byAdmin, byOs,
    byStatus, eosWarnings, warrantyWarnings, dataQuality,
    pendingMovements, recentMovements, openMaintenance, recentMaintenance, expiringContracts,
    bringInPending, bringOutInProgress,
    byTeam, issueSummary, cleanupCount, cleanupQueue, dupSuspect, rackConflicts,
    freshness, byTeamFreshness,
  };
}

// scope = scopeWhere(actor,"team_id"), scopeA = scopeWhere(actor,"a.team_id") — 호출자가 주입(단일 진실원천 유지, 프레임워크/별칭 의존 제거).
export function computeCleanupStats(
  db: Database.Database,
  scope: ScopeClause,
  scopeA: ScopeClause,
): CleanupStats {

  // 팀별 자산 수 (admin: 전체 팀+미배정 / team: 자기 팀 / viewer: 전체)
  const byTeam = db.prepare(`
    SELECT COALESCE(t.team_name, '미배정') AS team_name, a.team_id, COUNT(*) AS c
    FROM assets a LEFT JOIN teams t ON a.team_id = t.id
    WHERE ${scopeA.sql}
    GROUP BY a.team_id ORDER BY c DESC
  `).all(...scopeA.params) as CleanupStats["byTeam"];

  // import_issue 유형별: ip_format=오류, missing_id=식별자없음, missing_os=OS미입력, dup_suspect=중복의심, date_format=날짜 해석 불가.
  // admin/viewer(scope 1=1)는 미연결(asset_id NULL) raw 이슈까지 포함, team은 자기 팀 자산에 연결된 이슈만.
  const importIssues = db.prepare(`
    SELECT ii.issue_type, COUNT(*) AS c
    FROM import_issue ii LEFT JOIN assets a ON ii.asset_id = a.id
    WHERE ii.status = 'open' AND ${scopeA.sql}
    GROUP BY ii.issue_type
  `).all(...scopeA.params) as { issue_type: string; c: number }[];
  const ic = (t: string) => importIssues.find((x) => x.issue_type === t)?.c ?? 0;
  const issueSummary = {
    error: ic("ip_format"),
    missing_id: ic("missing_id"),
    missing_os: ic("missing_os"),
    dup_suspect: ic("dup_suspect"),
    date_format: ic("date_format"),
  };

  // 정리 필요 큐 (v_cleanup_queue 뷰: IP/OS/관리자/랙 미입력 + import_issue 보유)
  const cleanupCount = (db.prepare(
    `SELECT COUNT(*) AS c FROM v_cleanup_queue q JOIN assets a ON q.asset_id = a.id WHERE ${scopeA.sql}`,
  ).get(...scopeA.params) as { c: number }).c;
  const cleanupQueue = db.prepare(`
    SELECT q.asset_id, q.asset_name, q.asset_type, q.missing_ip, q.missing_os, q.missing_admin, q.missing_rack, q.import_issue_count
    FROM v_cleanup_queue q JOIN assets a ON q.asset_id = a.id
    WHERE ${scopeA.sql}
    ORDER BY (q.missing_ip + q.missing_os + q.missing_admin + q.missing_rack + MIN(q.import_issue_count, 1)) DESC, q.asset_name
    LIMIT 50
  `).all(...scopeA.params) as CleanupStats["cleanupQueue"];

  // 중복 의심 (동명이기 판별): 동일 asset_name 다건. 같은 이름+시리얼/IP 미구분 = 진성 중복 후보.
  const dupGroups = db.prepare(`
    SELECT asset_name, COUNT(*) AS c,
      COUNT(DISTINCT NULLIF(serial_number, '')) AS distinct_serials,
      COUNT(DISTINCT NULLIF(ip_address, '')) AS distinct_ips
    FROM assets WHERE asset_name != '' AND ${scope.sql}
    GROUP BY asset_name HAVING c > 1 ORDER BY c DESC
  `).all(...scope.params) as DupGroup[];
  const dupSuspect = {
    groups: dupGroups.length,
    assets: dupGroups.reduce((s, g) => s + g.c, 0),
    likelyDup: dupGroups.filter((g) => g.distinct_serials <= 1 && g.distinct_ips <= 1).length,
    topGroups: dupGroups.slice(0, 20),
  };

  // ── 실장 충돌 / 범위초과 (랙 배치 데이터 품질) ──
  // 충돌 규칙은 src/lib/rack-overlap.ts overlaps()·src/lib/rack-validation.ts의 겹침 쿼리와 동일해야 한다:
  //  1) U 구간 겹침: a.start <= b.end AND b.start <= a.end (end = start + size - 1)
  //  2) 반폭(side) 규칙: a.rack_side IS NULL OR b.rack_side IS NULL OR a.rack_side = b.rack_side
  //     → 전폭(null)은 모두와 충돌, 반폭(L/R)끼리는 같은 방향만 충돌.
  // scope: 쌍의 어느 한쪽이라도 actor 범위 내 자산이면 노출(EXISTS 서브쿼리 — scope.sql의
  // 비별칭 team_id가 서브쿼리 s에 바인딩된다). a.id < b.id로 쌍 중복 제거.
  const conflictRows = db.prepare(`
    SELECT r.rack_name,
      MAX(a.rack_unit_start, b.rack_unit_start) AS ov_start,
      MIN(a.rack_unit_start + COALESCE(a.rack_unit_size, 1) - 1,
          b.rack_unit_start + COALESCE(b.rack_unit_size, 1) - 1) AS ov_end,
      a.asset_name AS a_name, b.asset_name AS b_name
    FROM assets a
    JOIN assets b ON b.rack_id = a.rack_id AND a.id < b.id
    JOIN racks r ON r.id = a.rack_id
    WHERE a.rack_unit_start IS NOT NULL AND b.rack_unit_start IS NOT NULL
      AND a.rack_unit_start <= b.rack_unit_start + COALESCE(b.rack_unit_size, 1) - 1
      AND b.rack_unit_start <= a.rack_unit_start + COALESCE(a.rack_unit_size, 1) - 1
      AND (a.rack_side IS NULL OR b.rack_side IS NULL OR a.rack_side = b.rack_side)
      AND EXISTS (SELECT 1 FROM assets s WHERE s.id IN (a.id, b.id) AND ${scope.sql})
    ORDER BY r.rack_name, ov_start
    LIMIT 20
  `).all(...scope.params) as { rack_name: string; ov_start: number; ov_end: number; a_name: string; b_name: string }[];

  // 범위초과: 배치 끝(start + size - 1)이 랙 용량(total_units)을 넘는 자산.
  const overflowRows = db.prepare(`
    SELECT r.rack_name, a.asset_name,
      a.rack_unit_start AS u_start,
      a.rack_unit_start + COALESCE(a.rack_unit_size, 1) - 1 AS u_end,
      r.total_units
    FROM assets a JOIN racks r ON a.rack_id = r.id
    WHERE a.rack_unit_start IS NOT NULL
      AND a.rack_unit_start + COALESCE(a.rack_unit_size, 1) - 1 > r.total_units
      AND ${scopeA.sql}
    ORDER BY r.rack_name, u_start
    LIMIT 20
  `).all(...scopeA.params) as { rack_name: string; asset_name: string; u_start: number; u_end: number; total_units: number }[];

  const fmtRange = (s: number, e: number) => (s === e ? `${s}U` : `${s}~${e}U`);
  const rackConflicts = {
    conflicts: conflictRows.map((c) => ({
      rack_name: c.rack_name,
      unit_range: fmtRange(c.ov_start, c.ov_end),
      a_name: c.a_name,
      b_name: c.b_name,
    })),
    overflows: overflowRows.map((o) => ({
      rack_name: o.rack_name,
      asset_name: o.asset_name,
      unit_range: fmtRange(o.u_start, o.u_end),
      total_units: o.total_units,
    })),
  };

  return { byTeam, issueSummary, cleanupCount, cleanupQueue, dupSuspect, rackConflicts };
}

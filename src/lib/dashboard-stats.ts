// P6 대시보드 정리-필요-큐/데이터품질 집계 (AC-2/13/14). 순수 모듈(프레임워크 import 없음)이라
// 대시보드 페이지와 테스트가 동일 코드를 공유한다(단일 진실원천). 모든 집계는 actor의 scopeWhere로 제한.
import type Database from "better-sqlite3";
import type { ScopeClause } from "./authz";

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
  issueSummary: { error: number; missing_id: number; missing_os: number; dup_suspect: number };
  cleanupCount: number;
  cleanupQueue: {
    asset_id: number; asset_name: string; asset_type: string;
    missing_ip: number; missing_os: number; missing_admin: number; missing_rack: number;
    import_issue_count: number;
  }[];
  dupSuspect: { groups: number; assets: number; likelyDup: number; topGroups: DupGroup[] };
  rackConflicts: { conflicts: RackConflict[]; overflows: RackOverflow[] };
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

  // import_issue 유형별: ip_format=오류, missing_id=식별자없음, missing_os=OS미입력, dup_suspect=중복의심.
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

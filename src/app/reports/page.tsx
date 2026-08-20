export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { actorFromSession, scopeWhere, rackScopeWhere, locationScopeWhere } from "@/lib/authz";
import { ReportView } from "./ReportView";

// ── 통계 리포트 (외부 검토 가격심의 갭 5 대응) ──
// 심의·감사·상부 보고용 집계 화면. 대시보드(운영 계기판)와 달리 인쇄를 전제로 한 표 중심 산출물.
// 조회 전용 — 모든 수치는 조회 시점 스냅샷이며 기준 시각을 명기한다.
export default async function ReportsPage() {
  const db = getDb();
  const actor = actorFromSession(await getSession());
  const scope = scopeWhere(actor, "team_id");
  const scopeA = scopeWhere(actor, "a.team_id");

  // 1. 유형 × 상태 매트릭스
  const byTypeStatus = db.prepare(`
    SELECT asset_type, status, COUNT(*) AS c FROM assets WHERE ${scope.sql} GROUP BY asset_type, status
  `).all(...scope.params) as { asset_type: string; status: string; c: number }[];

  // 2. 팀별 현황 (장비/부속/실장/IP)
  const subScope = scopeWhere(actor, "s.team_id");
  const byTeam = db.prepare(`
    SELECT COALESCE(t.team_name, '미배정') AS team_name,
      COUNT(*) AS assets,
      SUM(CASE WHEN a.rack_id IS NOT NULL THEN 1 ELSE 0 END) AS racked,
      SUM(CASE WHEN a.ip_address != '' THEN 1 ELSE 0 END) AS with_ip,
      (SELECT COUNT(*) FROM sub_assets s WHERE s.team_id = a.team_id AND s.status != 'disposed') AS subs
    FROM assets a LEFT JOIN teams t ON a.team_id = t.id
    WHERE ${scopeA.sql}
    GROUP BY a.team_id ORDER BY assets DESC
  `).all(...scopeA.params) as any[];

  // 3. 위치·랙 사용률 — 팀은 자기에게 보이는 위치/랙만(하이브리드). 총괄/전체열람은 전체.
  const locScope = locationScopeWhere(actor, "l.team_id", "l.id");
  const rackScopeJoin = rackScopeWhere(actor, "r.team_id", "r.id");
  const byLocation = db.prepare(`
    SELECT l.location_name, COUNT(DISTINCT r.id) AS racks,
      COALESCE(SUM(CASE WHEN ${rackScopeJoin.sql} THEN r.total_units ELSE 0 END), 0) AS total_units,
      COALESCE((SELECT SUM(a.rack_unit_size) FROM assets a JOIN racks r2 ON a.rack_id = r2.id WHERE r2.location_id = l.id AND ${scopeA.sql}), 0) AS used_units
    FROM locations l LEFT JOIN racks r ON r.location_id = l.id AND ${rackScopeJoin.sql}
    WHERE ${locScope.sql}
    GROUP BY l.id ORDER BY l.sort_order, l.location_name
  `).all(...rackScopeJoin.params, ...scopeA.params, ...rackScopeJoin.params, ...locScope.params) as any[];

  // 4. CIA 등급 분포 (미평가 포함)
  const byCia = db.prepare(`
    SELECT COALESCE(NULLIF(cia_grade, ''), '미평가') AS grade, COUNT(*) AS c
    FROM assets WHERE ${scope.sql} GROUP BY grade
  `).all(...scope.params) as { grade: string; c: number }[];

  // 5. 도입 연도별 (구매일 기준) — 노후장비 파악
  const byYear = db.prepare(`
    SELECT CASE WHEN purchase_date = '' THEN '미상' ELSE substr(purchase_date, 1, 4) END AS y, COUNT(*) AS c
    FROM assets WHERE ${scope.sql} GROUP BY y ORDER BY (y = '미상') ASC, y DESC
  `).all(...scope.params) as { y: string; c: number }[];

  // 6. 총괄 수치
  const rackScopeC = rackScopeWhere(actor, "team_id", "id");
  const frameScope = scopeWhere(actor, "team_id");
  const totals = {
    assets: (db.prepare(`SELECT COUNT(*) c FROM assets WHERE ${scope.sql}`).get(...scope.params) as any).c,
    subs: (db.prepare(`SELECT COUNT(*) c FROM sub_assets s WHERE s.status != 'disposed' AND ${subScope.sql}`).get(...subScope.params) as any).c,
    racks: (db.prepare(`SELECT COUNT(*) c FROM racks WHERE ${rackScopeC.sql}`).get(...rackScopeC.params) as any).c,
    frames: (db.prepare(`SELECT COUNT(*) c FROM dist_frames WHERE ${frameScope.sql}`).get(...frameScope.params) as any).c,
  };

  const asOf = new Date().toLocaleString("ko-KR", { hour12: false });

  return (
    <ReportView
      byTypeStatus={byTypeStatus}
      byTeam={byTeam}
      byLocation={byLocation}
      byCia={byCia}
      byYear={byYear}
      totals={totals}
      asOf={asOf}
    />
  );
}

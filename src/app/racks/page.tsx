export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { RackView } from "./RackView";
import Link from "next/link";
import { scopeWhere, actorFromSession, rackScopeWhere, locationScopeWhere } from "@/lib/authz";
import { getSession } from "@/lib/auth";

export default async function RacksPage() {
  const db = getDb();
  const actor = actorFromSession(await getSession());
  const assetScope = scopeWhere(actor, "team_id");
  // 랙: 소유(team_id) OR 내 팀 자산이 있는 랙(하이브리드). 위치: 소유 OR 내게 보이는 랙/대역/배선 존재.
  const rackScope = rackScopeWhere(actor, "r.team_id", "r.id");
  const locScope = locationScopeWhere(actor, "l.team_id", "l.id");
  const locations = db.prepare(`
    SELECT l.*, 
      (SELECT COUNT(*) FROM racks r2 WHERE r2.location_id = l.id AND ${rackScopeWhere(actor, "r2.team_id", "r2.id").sql}) as rack_count
    FROM locations l WHERE ${locScope.sql} ORDER BY l.sort_order, l.location_name
  `).all(...rackScopeWhere(actor, "r2.team_id", "r2.id").params, ...locScope.params) as any[];

  const racks = db.prepare(`
    SELECT r.*, l.location_name, t.team_name AS owner_team_name
    FROM racks r
    LEFT JOIN locations l ON r.location_id = l.id
    LEFT JOIN teams t ON r.team_id = t.id
    WHERE ${rackScope.sql}
    ORDER BY l.sort_order, l.location_name, r.rack_name
  `).all(...rackScope.params) as any[];

  // 실장 자산 — 폐기(retired) 제외: 폐기 장비는 실장도에서 슬롯을 점유하지 않는다.
  const assets = db.prepare(`
    SELECT id, asset_name, asset_type, rack_id, rack_unit_start, rack_unit_size, rack_side, manufacturer, model, ip_address, status
    FROM assets
    WHERE rack_id IS NOT NULL AND rack_unit_start IS NOT NULL AND rack_unit_size IS NOT NULL AND rack_unit_size >= 1 AND status != 'retired' AND ${assetScope.sql}
    ORDER BY rack_unit_start
  `).all(...assetScope.params) as any[];

  // 미배치 자산 (드래그앤드롭 배치 대상) — 폐기 제외, 팀 스코프 적용
  const unplacedAssets = db.prepare(`
    SELECT id, asset_name, asset_type, rack_id, rack_unit_start, rack_unit_size, rack_side, manufacturer, model, ip_address, status
    FROM assets
    WHERE (rack_id IS NULL OR rack_unit_start IS NULL) AND status != 'retired' AND ${assetScope.sql}
    ORDER BY asset_name
  `).all(...assetScope.params) as any[];

  // 선번장 바로가기용: 랙에 실장된 배선반(FDF 등) 위치 — 소유 전용(팀은 자기 배선반만)
  const frameScope = scopeWhere(actor, "team_id");
  const distFrames = db.prepare(`
    SELECT id, rack_id, rack_unit_start, rack_unit_size FROM dist_frames WHERE rack_id IS NOT NULL AND ${frameScope.sql}
  `).all(...frameScope.params) as any[];

  // 총괄 전용: 랙 소유 팀 배정 드롭다운용 팀 목록
  const teams = actor?.role === "admin" ? (db.prepare("SELECT id, team_name FROM teams ORDER BY team_name").all() as any[]) : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <span className="eyebrow">RACK LAYOUT</span>
          <h2 className="text-2xl font-bold tracking-tight">랙 실장도</h2>
          <p className="text-sm text-ink-3 mt-1">위치별 랙 사용 현황과 장비 배치를 확인합니다. 랙 추가는 여기서 바로, 수정/삭제는 위치관리에서 수행합니다.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/locations" className="btn-ink px-3 py-1.5 text-sm">위치/랙 관리</Link>
          <Link href="/assets" className="btn-ink px-3 py-1.5 text-sm">자산관리</Link>
        </div>
      </div>
      <RackView locations={locations} racks={racks} assets={assets} unplacedAssets={unplacedAssets} distFrames={distFrames} canWrite={!!actor && actor.role !== "viewer"} teams={teams} isAdmin={actor?.role === "admin"} />
    </div>
  );
}

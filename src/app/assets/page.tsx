export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { AssetTable } from "./AssetTable";
import { getSession } from "@/lib/auth";
import { actorFromSession, scopeWhere, rackScopeWhere } from "@/lib/authz";

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ rack_id?: string; missing?: string; q?: string }> }) {
  const db = getDb();
  const actor = actorFromSession(await getSession());
  const scope = scopeWhere(actor, "a.team_id");
  const assets = db.prepare(`
    SELECT a.*, r.rack_name, l.location_name, t.team_name
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id
    LEFT JOIN teams t ON a.team_id = t.id
    WHERE ${scope.sql}
    ORDER BY a.created_at DESC
  `).all(...scope.params) as any[];

  // 배치 대상 랙: 팀은 자기 소유 랙 또는 공유(NULL) 랙 + 내 자산이 있는 랙(하이브리드). 총괄/전체열람은 전체.
  const rackScope = rackScopeWhere(actor, "r.team_id", "r.id");
  const racks = db.prepare(`
    SELECT r.id, r.rack_name, r.total_units, r.team_id, l.location_name
    FROM racks r LEFT JOIN locations l ON r.location_id = l.id
    WHERE ${rackScope.sql}
    ORDER BY r.rack_name
  `).all(...rackScope.params) as any[];

  const customFields = db.prepare(`
    SELECT * FROM custom_fields WHERE is_active = 1 ORDER BY sort_order, id
  `).all() as any[];

  // 자산별 커스텀 값을 미리 로드
  const customValues = db.prepare(`
    SELECT cv.asset_id, cv.field_id, cv.value
    FROM custom_values cv
    JOIN custom_fields cf ON cv.field_id = cf.id
    WHERE cf.is_active = 1
  `).all() as any[];
  // 관리부서(소유 팀) 목록 — 일괄수정 팀 재지정 드롭다운용
  const teams = db.prepare(`SELECT id, team_name FROM teams ORDER BY team_name`).all() as any[];

  // asset_id -> { field_id: value }
  const cvMap: Record<number, Record<number, string>> = {};
  for (const cv of customValues) {
    if (!cvMap[cv.asset_id]) cvMap[cv.asset_id] = {};
    cvMap[cv.asset_id][cv.field_id] = cv.value;
  }

  const sp = await searchParams;
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <span className="eyebrow">ASSETS</span>
          <h2 className="text-2xl font-bold tracking-tight">자산관리</h2>
        </div>
      </div>
      <AssetTable assets={assets} racks={racks} customFields={customFields} customValuesMap={cvMap} teams={teams} isAdmin={actor?.role === "admin"} initialRackId={sp.rack_id ?? null} initialMissing={sp.missing ?? null} initialSearch={sp.q ?? null} />
    </div>
  );
}

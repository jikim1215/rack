export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { requireMenuPage } from "@/lib/page-authz";
import { AssetTable } from "./AssetTable";
import { rackScopeWhere } from "@/lib/authz";
import { listAssets, ASSET_MISSING_FILTERS, type AssetMissingFilter } from "@/lib/asset-list";
import type { RackRow, CustomFieldRow, TeamRow } from "@/lib/db-types";

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ rack_id?: string; missing?: string; q?: string }> }) {
  const db = getDb();
  const actor = await requireMenuPage("assets"); // 메뉴 접근 게이트(P1): 권한 없으면 /access-denied
  const sp = await searchParams;
  // 첫 페이지만 SSR — API 와 같은 쿼리(listAssets)라 필터 의미가 어긋나지 않는다. 이후 페이지·조건 변경은 클라이언트가 /api/assets 로.
  const rackIdRaw = Number(sp.rack_id);
  const missing = (ASSET_MISSING_FILTERS as readonly string[]).includes(sp.missing ?? "") ? (sp.missing as AssetMissingFilter) : "";
  const list = listAssets(db, actor, {
    q: sp.q ?? "",
    rack_id: Number.isInteger(rackIdRaw) && rackIdRaw > 0 ? rackIdRaw : null,
    missing,
    limit: 100, offset: 0, withCustomValues: true,
  });
  const assets = list.rows;

  // 배치 대상 랙: 팀은 자기 소유 랙 또는 공유(NULL) 랙 + 내 자산이 있는 랙(하이브리드). 총괄/전체열람은 전체.
  const rackScope = rackScopeWhere(actor, "r.team_id", "r.id");
  const racks = db.prepare(`
    SELECT r.id, r.rack_name, r.total_units, r.team_id, l.location_name
    FROM racks r LEFT JOIN locations l ON r.location_id = l.id
    WHERE ${rackScope.sql}
    ORDER BY r.rack_name
  `).all(...rackScope.params) as (Pick<RackRow, "id" | "rack_name" | "total_units" | "team_id"> & { location_name: string | null })[];

  const customFields = db.prepare(`
    SELECT * FROM custom_fields WHERE is_active = 1 ORDER BY sort_order, id
  `).all() as CustomFieldRow[];

  // 관리부서(소유 팀) 목록 — 일괄수정 팀 재지정 드롭다운용
  const teams = db.prepare(`SELECT id, team_name FROM teams ORDER BY team_name`).all() as Pick<TeamRow, "id" | "team_name">[];

  const cvMap = list.customValues ?? {};
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <span className="eyebrow">ASSETS</span>
          <h2 className="text-2xl font-bold tracking-tight">자산관리</h2>
        </div>
      </div>
      <AssetTable assets={assets} total={list.total} racks={racks} customFields={customFields} customValuesMap={cvMap} teams={teams} isAdmin={actor?.role === "admin"} initialRackId={sp.rack_id ?? null} initialMissing={sp.missing ?? null} initialSearch={sp.q ?? null} />
    </div>
  );
}

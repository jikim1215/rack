import { getDb } from "@/lib/db";
import { AssetTable } from "./AssetTable";

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ rack_id?: string }> }) {
  const db = getDb();
  const assets = db.prepare(`
    SELECT a.*, r.rack_name, l.location_name

    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id
    ORDER BY a.created_at DESC
  `).all() as any[];

  const racks = db.prepare(`
    SELECT r.id, r.rack_name, r.total_units, l.location_name
    FROM racks r LEFT JOIN locations l ON r.location_id = l.id
    ORDER BY r.rack_name
  `).all() as any[];

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

  // asset_id -> { field_id: value }
  const cvMap: Record<number, Record<number, string>> = {};
  for (const cv of customValues) {
    if (!cvMap[cv.asset_id]) cvMap[cv.asset_id] = {};
    cvMap[cv.asset_id][cv.field_id] = cv.value;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <span className="eyebrow">ASSETS</span>
          <h2 className="text-2xl font-bold tracking-tight">자산관리</h2>
        </div>
      </div>
      <AssetTable assets={assets} racks={racks} customFields={customFields} customValuesMap={cvMap} initialRackId={(await searchParams).rack_id ?? null} />
    </div>
  );
}

import { getDb } from "@/lib/db";
import { RackView } from "./RackView";
import Link from "next/link";

export default function RacksPage() {
  const db = getDb();
  const locations = db.prepare(`
    SELECT l.*, 
      (SELECT COUNT(*) FROM racks WHERE location_id = l.id) as rack_count
    FROM locations l ORDER BY l.location_name
  `).all() as any[];

  const racks = db.prepare(`
    SELECT r.*, l.location_name
    FROM racks r
    LEFT JOIN locations l ON r.location_id = l.id
    ORDER BY l.location_name, r.rack_name
  `).all() as any[];

  const assets = db.prepare(`
    SELECT id, asset_name, asset_type, rack_id, rack_unit_start, rack_unit_size, manufacturer, model, ip_address, status
    FROM assets
    WHERE rack_id IS NOT NULL AND rack_unit_start IS NOT NULL AND rack_unit_size IS NOT NULL AND rack_unit_size >= 1
    ORDER BY rack_unit_start
  `).all() as any[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <span className="eyebrow">RACK LAYOUT</span>
          <h2 className="text-2xl font-bold tracking-tight">랙 실장도</h2>
          <p className="text-sm text-ink-3 mt-1">위치별 랙 사용 현황과 장비 배치를 확인합니다. 랙 등록/수정은 위치관리에서 수행합니다.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/locations" className="btn-ink px-3 py-1.5 text-sm">위치/랙 관리</Link>
          <Link href="/assets" className="btn-ink px-3 py-1.5 text-sm">자산관리</Link>
        </div>
      </div>
      <RackView locations={locations} racks={racks} assets={assets} />
    </div>
  );
}

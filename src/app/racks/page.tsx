import { getDb } from "@/lib/db";
import { RackView } from "./RackView";

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
    WHERE rack_id IS NOT NULL AND rack_unit_start IS NOT NULL
    ORDER BY rack_unit_start
  `).all() as any[];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">랙 실장도</h2>
      <RackView locations={locations} racks={racks} assets={assets} />
    </div>
  );
}

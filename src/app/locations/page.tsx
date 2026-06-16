import { getDb } from "@/lib/db";
import { LocationManager } from "./LocationManager";

export default function LocationsPage() {
  const db = getDb();

  const locations = db.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM racks WHERE location_id = l.id) as rack_count,
      (SELECT COUNT(*) FROM assets a JOIN racks r ON a.rack_id = r.id WHERE r.location_id = l.id) as asset_count
    FROM locations l
    ORDER BY l.name
  `).all() as any[];

  const racks = db.prepare(`
    SELECT r.*, l.name as location_name,
      (SELECT COUNT(*) FROM assets WHERE rack_id = r.id) as asset_count,
      COALESCE((SELECT SUM(rack_unit_size) FROM assets WHERE rack_id = r.id), 0) as used_units
    FROM racks r
    LEFT JOIN locations l ON r.location_id = l.id
    ORDER BY l.name, r.name
  `).all() as any[];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">위치 관리</h2>
      <LocationManager locations={locations} racks={racks} />
    </div>
  );
}

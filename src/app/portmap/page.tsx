import { getDb } from "@/lib/db";
import { PortMapView } from "./PortMapView";

export default function PortMapPage() {
  const db = getDb();

  const networkAssets = db.prepare(`
    SELECT a.id, a.asset_name, a.manufacturer, a.model, a.ip_address, a.asset_type,
      r.rack_name, l.location_name
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id
    WHERE a.asset_type IN ('network', 'server', 'security')
    ORDER BY a.asset_type, a.asset_name

  `).all() as any[];

  const ports = db.prepare(`
    SELECT p.*, a.asset_name as asset_name,
      cp.port_name as connected_port_name,
      ca.asset_name as connected_asset_name
    FROM ports p
    JOIN assets a ON p.asset_id = a.id
    LEFT JOIN ports cp ON p.connected_to_port_id = cp.id
    LEFT JOIN assets ca ON cp.asset_id = ca.id
    ORDER BY p.asset_id, p.port_number
  `).all() as any[];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">네트워크 포트맵</h2>
      <PortMapView networkAssets={networkAssets} ports={ports} />
    </div>
  );
}

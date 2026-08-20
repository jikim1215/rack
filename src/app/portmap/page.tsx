export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { PortMapView } from "./PortMapView";
import { scopeWhere, actorFromSession } from "@/lib/authz";
import { getSession } from "@/lib/auth";

export default async function PortMapPage() {
  const db = getDb();
  const actor = actorFromSession(await getSession());
  const assetScope = scopeWhere(actor, "a.team_id");

  const networkAssets = db.prepare(`
    SELECT a.id, a.asset_name, a.manufacturer, a.model, a.ip_address, a.asset_type,
      r.rack_name, l.location_name
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id
    WHERE a.asset_type IN ('network', 'server', 'security') AND ${assetScope.sql}
    ORDER BY a.asset_type, a.asset_name

  `).all(...assetScope.params) as any[];

  const peerScope = scopeWhere(actor, "ca.team_id");
  const ports = db.prepare(`
    SELECT p.*, a.asset_name as asset_name,
      CASE WHEN ${peerScope.sql} THEN cp.port_name ELSE NULL END as connected_port_name,
      CASE WHEN ${peerScope.sql} THEN ca.asset_name ELSE NULL END as connected_asset_name
    FROM ports p
    JOIN assets a ON p.asset_id = a.id
    LEFT JOIN ports cp ON p.connected_to_port_id = cp.id
    LEFT JOIN assets ca ON cp.asset_id = ca.id
    WHERE ${assetScope.sql}
    ORDER BY p.asset_id, p.port_number
  `).all(...peerScope.params, ...peerScope.params, ...assetScope.params) as any[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="eyebrow">PORTMAP</div>
          <h2 className="text-2xl font-bold tracking-tight">포트맵</h2>
        </div>
      </div>
      <PortMapView networkAssets={networkAssets} ports={ports} />
    </div>
  );
}

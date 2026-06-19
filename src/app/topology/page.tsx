import { getDb } from "@/lib/db";
import { TopologyView } from "./TopologyView";

export default function TopologyPage() {
  const db = getDb();

  const assets = db.prepare(`
    SELECT a.id, a.asset_name, a.asset_type, a.ip_address, a.status
    FROM assets a
    WHERE a.asset_type IN ('network','server','security','telecom')
    ORDER BY a.asset_type, a.asset_name
  `).all() as any[];

  const connections = db.prepare(`
    SELECT p.id, p.asset_id, p.port_name,
           p.connected_to_port_id,
           cp.asset_id as connected_asset_id
    FROM ports p
    LEFT JOIN ports cp ON p.connected_to_port_id = cp.id
    WHERE p.connected_to_port_id IS NOT NULL
  `).all() as any[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="eyebrow">TOPOLOGY</div>
          <h2 className="text-2xl font-bold tracking-tight">네트워크 토폴로지</h2>
        </div>
      </div>
      <TopologyView assets={assets} connections={connections} />
    </div>
  );
}

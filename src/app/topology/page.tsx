export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { scopeWhere, actorFromSession } from "@/lib/authz";
import { getSession } from "@/lib/auth";
import { TopologyView } from "./TopologyView";

export default async function TopologyPage() {
  const db = getDb();
  const actor = actorFromSession(await getSession());

  const assetScope = scopeWhere(actor, "a.team_id");
  const assets = db.prepare(`
    SELECT a.id, a.asset_name, a.asset_type, a.ip_address, a.status
    FROM assets a
    WHERE a.asset_type IN ('network','server','security','telecom')
      AND ${assetScope.sql}
    ORDER BY a.asset_type, a.asset_name
  `).all(...assetScope.params) as any[];

  // 연결(엣지)은 양 끝 자산이 모두 가시 범위일 때만 노출 — 타팀 자산 식별자 누출 방지.
  const ownerScope = scopeWhere(actor, "a.team_id");
  const peerScope = scopeWhere(actor, "ca.team_id");
  const connections = db.prepare(`
    SELECT p.id, p.asset_id, p.port_name,
           p.connected_to_port_id,
           cp.asset_id as connected_asset_id
    FROM ports p
    JOIN assets a ON p.asset_id = a.id
    LEFT JOIN ports cp ON p.connected_to_port_id = cp.id
    LEFT JOIN assets ca ON cp.asset_id = ca.id
    WHERE p.connected_to_port_id IS NOT NULL
      AND ${ownerScope.sql}
      AND (cp.asset_id IS NULL OR ${peerScope.sql})
  `).all(...ownerScope.params, ...peerScope.params) as any[];

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

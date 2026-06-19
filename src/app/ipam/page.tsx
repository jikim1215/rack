import { getDb } from "@/lib/db";
import { IpamView } from "./IpamView";

export default function IpamPage() {
  const db = getDb();

  const subnets = db.prepare(
    `SELECT s.*, l.location_name FROM ip_subnets s
     LEFT JOIN locations l ON s.location_id = l.id
     ORDER BY s.network_address`
  ).all() as any[];

  const assetIps = db.prepare(
    `SELECT ai.*, a.asset_name FROM asset_ips ai
     LEFT JOIN assets a ON ai.asset_id = a.id`
  ).all() as any[];

  const locations = db.prepare(
    "SELECT * FROM locations ORDER BY location_name"
  ).all() as any[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="eyebrow">IPAM</div>
          <h2 className="text-2xl font-bold tracking-tight">IP관리</h2>
        </div>
      </div>
      <IpamView subnets={subnets} assetIps={assetIps} locations={locations} />
    </div>
  );
}

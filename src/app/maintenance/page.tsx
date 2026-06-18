import { getDb } from "@/lib/db";
import MaintenanceView from "./MaintenanceView";

export default function MaintenancePage() {
  const db = getDb();
  const logs = db.prepare(`
    SELECT ml.*, a.asset_name, v.vendor_name
    FROM maintenance_logs ml
    LEFT JOIN assets a ON ml.asset_id = a.id
    LEFT JOIN vendors v ON ml.vendor_id = v.id
    ORDER BY ml.created_at DESC
  `).all() as any[];

  const assets = db.prepare(`SELECT id, asset_name FROM assets ORDER BY asset_name`).all() as any[];
  const vendors = db.prepare(`SELECT id, vendor_name FROM vendors ORDER BY vendor_name`).all() as any[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">유지보수/장애 관리</h2>
      </div>
      <MaintenanceView logs={logs} assets={assets} vendors={vendors} />
    </div>
  );
}

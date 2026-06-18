import { getDb } from "@/lib/db";
import MovementsView from "./MovementsView";

export default function MovementsPage() {
  const db = getDb();

  const movements = db.prepare(`
    SELECT m.*, a.asset_name
    FROM asset_movements m
    LEFT JOIN assets a ON m.asset_id = a.id
    ORDER BY m.created_at DESC
  `).all() as any[];

  const assets = db.prepare(`
    SELECT id, asset_name, serial_number FROM assets ORDER BY asset_name
  `).all() as any[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">반입/반출 관리</h2>
      </div>
      <MovementsView movements={movements} assets={assets} />
    </div>
  );
}

export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { scopeWhere, actorFromSession } from "@/lib/authz";
import { getSession } from "@/lib/auth";
import MovementsView from "./MovementsView";

export default async function MovementsPage() {
  const db = getDb();
  const actor = actorFromSession(await getSession());

  const movementsScope = scopeWhere(actor, "a.team_id");
  const movements = db.prepare(`
    SELECT m.*, a.asset_name
    FROM asset_movements m
    LEFT JOIN assets a ON m.asset_id = a.id
    WHERE (m.asset_id IS NULL OR ${movementsScope.sql})
    ORDER BY m.created_at DESC
  `).all(...movementsScope.params) as any[];

  const assetsScope = scopeWhere(actor, "a.team_id");
  const assets = db.prepare(`
    SELECT a.id, a.asset_name, a.serial_number, a.manufacturer, a.model,
           a.rack_unit_size, a.rack_unit_start, a.rack_side, r.rack_name
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    WHERE ${assetsScope.sql}
    ORDER BY a.asset_name
  `).all(...assetsScope.params) as any[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="eyebrow">I/O</p>
          <h2 className="text-2xl font-bold tracking-tight">반입/반출</h2>
        </div>
      </div>
      <MovementsView movements={movements} assets={assets} />
    </div>
  );
}

export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { scopeWhere, actorFromSession, rackScopeWhere, locationScopeWhere } from "@/lib/authz";
import { getSession } from "@/lib/auth";
import { LocationManager } from "./LocationManager";

export default async function LocationsPage() {
  const db = getDb();
  const actor = actorFromSession(await getSession());
  const scopeA = scopeWhere(actor, "a.team_id");
  const scopeBare = scopeWhere(actor, "team_id");
  // 위치: 소유 OR 내게 보이는 랙/대역/배선 존재(하이브리드). 랙: 소유 OR 내 팀 자산 존재.
  const locScope = locationScopeWhere(actor, "l.team_id", "l.id");
  const rackScope = rackScopeWhere(actor, "r.team_id", "r.id");
  const rackCountScope = rackScopeWhere(actor, "r2.team_id", "r2.id");

  const locations = db.prepare(`
    SELECT l.*, t.team_name AS owner_team_name,
      (SELECT COUNT(*) FROM racks r2 WHERE r2.location_id = l.id AND ${rackCountScope.sql}) as rack_count,
      (SELECT COUNT(*) FROM assets a JOIN racks r ON a.rack_id = r.id WHERE r.location_id = l.id AND ${scopeA.sql}) as asset_count
    FROM locations l
    LEFT JOIN teams t ON l.team_id = t.id
    WHERE ${locScope.sql}
    ORDER BY l.sort_order, l.location_name
  `).all(...rackCountScope.params, ...scopeA.params, ...locScope.params) as any[];

  const racks = db.prepare(`
    SELECT r.*, l.location_name, t.team_name AS owner_team_name,
      (SELECT COUNT(*) FROM assets WHERE rack_id = r.id AND ${scopeBare.sql}) as asset_count,
      COALESCE((SELECT SUM(rack_unit_size) FROM assets WHERE rack_id = r.id AND ${scopeBare.sql}), 0) as used_units
    FROM racks r
    LEFT JOIN locations l ON r.location_id = l.id
    LEFT JOIN teams t ON r.team_id = t.id
    WHERE ${rackScope.sql}
    ORDER BY l.sort_order, l.location_name, r.rack_name
  `).all(...scopeBare.params, ...scopeBare.params, ...rackScope.params) as any[];

  const teams = actor?.role === "admin" ? (db.prepare("SELECT id, team_name FROM teams ORDER BY team_name").all() as any[]) : [];
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="eyebrow">LOCATION</div>
          <h2 className="text-2xl font-bold tracking-tight">위치관리</h2>
        </div>
      </div>
      <LocationManager locations={locations} racks={racks} teams={teams} isAdmin={actor?.role === "admin"} />
    </div>
  );
}

export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import ContractsView from "./ContractsView";
import { getSession } from "@/lib/auth";
import { actorFromSession, scopeWhere } from "@/lib/authz";

export default async function ContractsPage() {
  const db = getDb();
  const actor = actorFromSession(await getSession());
  // 소유 전용(team_id): 팀은 자기 팀 계약만. 총괄/전체열람은 전체.
  const scope = scopeWhere(actor, "c.team_id");
  const vendors = db.prepare(`SELECT * FROM vendors WHERE is_active = 1 ORDER BY vendor_name`).all() as any[];
  const contracts = db.prepare(`
    SELECT c.*, v.vendor_name, t.team_name AS owner_team_name
    FROM contracts c
    LEFT JOIN vendors v ON c.vendor_id = v.id
    LEFT JOIN teams t ON c.team_id = t.id
    WHERE ${scope.sql}
    ORDER BY c.end_date
  `).all(...scope.params) as any[];

  const teams = actor?.role === "admin" ? (db.prepare("SELECT id, team_name FROM teams ORDER BY team_name").all() as any[]) : [];

  return <ContractsView vendors={vendors} contracts={contracts} teams={teams} isAdmin={actor?.role === "admin"} />;
}

export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { requireMenuPage } from "@/lib/page-authz";
import ContractsView from "./ContractsView";
import { scopeWhere } from "@/lib/authz";
import type { VendorRow, ContractRow, TeamRow } from "@/lib/db-types";

export default async function ContractsPage() {
  const db = getDb();
  const actor = await requireMenuPage("contracts"); // 메뉴 접근 게이트(P1): 권한 없으면 /access-denied
  // 소유 전용(team_id): 팀은 자기 팀 계약만. 총괄/전체열람은 전체.
  const scope = scopeWhere(actor, "c.team_id");
  const vendors = db.prepare(`SELECT * FROM vendors WHERE is_active = 1 ORDER BY vendor_name`).all() as VendorRow[];
  const contracts = db.prepare(`
    SELECT c.*, v.vendor_name, t.team_name AS owner_team_name
    FROM contracts c
    LEFT JOIN vendors v ON c.vendor_id = v.id
    LEFT JOIN teams t ON c.team_id = t.id
    WHERE ${scope.sql}
    ORDER BY c.end_date
  `).all(...scope.params) as (ContractRow & { vendor_name: string | null; owner_team_name: string | null })[];

  const teams = actor?.role === "admin" ? (db.prepare("SELECT id, team_name FROM teams ORDER BY team_name").all() as Pick<TeamRow, "id" | "team_name">[]) : [];

  return <ContractsView vendors={vendors} contracts={contracts} teams={teams} isAdmin={actor?.role === "admin"} />;
}

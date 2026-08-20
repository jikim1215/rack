export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { UnassignedQueue } from "./UnassignedQueue";

// 미배정 큐 (AC-11) — 총괄(admin) 전용. team_id 미배정(NULL) 자산을 팀에 재배정한다.
export default async function UnassignedPage() {
  const session = await getSession();
  if (session?.role !== "admin") {
    redirect("/");
  }
  const db = getDb();
  const assets = db.prepare(`
    SELECT a.id, a.asset_name, a.asset_type, a.ip_address, a.status, a.department,
           a.admin_name, a.os, r.rack_name, l.location_name
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id
    WHERE a.team_id IS NULL
    ORDER BY a.created_at DESC
  `).all() as any[];
  const teams = db.prepare("SELECT id, team_name FROM teams ORDER BY team_name").all() as any[];
  return <UnassignedQueue assets={assets} teams={teams} />;
}

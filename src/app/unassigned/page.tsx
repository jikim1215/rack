export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { UnassignedQueue } from "./UnassignedQueue";
import { listAssets, UNASSIGNED_PAGE_SIZE } from "@/lib/asset-list";
import { getActor } from "@/lib/api-authz";
import type { TeamRow } from "@/lib/db-types";
export const metadata = { title: "미배정 큐" };

// 미배정 큐 (AC-11) — 총괄(admin) 전용. team_id 미배정(NULL) 자산을 팀에 재배정한다.
export default async function UnassignedPage() {
  const session = await getSession();
  if (session?.role !== "admin") {
    redirect("/");
  }
  const db = getDb();
  // 목록은 첫 페이지만 SSR, 이후 페이지는 /api/assets?scope=unassigned(같은 listAssets)로. 예전엔 미배정 전량을 한 번에
  // 렌더해 자산 1만 건 이관 직후 화면이 8MB·행 1만 개였다(실측). 부서별 일괄 배정은 아래 집계로 전량을 다룬다.
  const first = listAssets(db, await getActor(), {
    unassignedOnly: true, sort: "created_at", dir: "desc", limit: UNASSIGNED_PAGE_SIZE, offset: 0,
  });

  const departmentSummary = db.prepare(`
    SELECT COALESCE(department, '') as department, COUNT(*) as count
    FROM assets
    WHERE team_id IS NULL
    GROUP BY COALESCE(department, '')
    ORDER BY count DESC, department ASC
  `).all() as { department: string; count: number }[];

  const teams = db.prepare("SELECT id, team_name FROM teams ORDER BY team_name").all() as Pick<TeamRow, "id" | "team_name">[];

  return <UnassignedQueue initialRows={first.rows} total={first.total} pageSize={UNASSIGNED_PAGE_SIZE} teams={teams} departmentSummary={departmentSummary} />;
}

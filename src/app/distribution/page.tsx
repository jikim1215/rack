export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { DistributionView } from "./DistributionView";
import { getSession } from "@/lib/auth";
import { actorFromSession, scopeWhere } from "@/lib/authz";

export default async function DistributionPage({ searchParams }: { searchParams: Promise<{ frame?: string }> }) {
  const db = getDb();
  const actor = actorFromSession(await getSession());
  // 소유 전용(team_id): 팀은 자기 팀 배선반만. 총괄/전체열람은 전체.
  const scope = scopeWhere(actor, "df.team_id");

  const frames = db.prepare(`
    SELECT df.*, l.location_name, l.building, l.floor, l.room, t.team_name AS owner_team_name
    FROM dist_frames df
    LEFT JOIN locations l ON df.location_id = l.id
    LEFT JOIN teams t ON df.team_id = t.id
    WHERE ${scope.sql}
    ORDER BY l.building, l.floor, df.frame_name
  `).all(...scope.params) as any[];

  const pairs = db.prepare(`
    SELECT fp.*,
      lp.pair_number AS linked_pair_number, lp.frame_id AS linked_frame_id,
      lf.frame_name AS linked_frame_name,
      p.port_number AS connected_port_number, p.port_name AS connected_port_name,
      a.asset_name AS connected_asset_name
    FROM frame_pairs fp
    JOIN dist_frames df ON fp.frame_id = df.id
    LEFT JOIN frame_pairs lp ON fp.linked_pair_id = lp.id
    LEFT JOIN dist_frames lf ON lp.frame_id = lf.id
    LEFT JOIN ports p ON fp.connected_port_id = p.id
    LEFT JOIN assets a ON p.asset_id = a.id
    WHERE ${scope.sql}
    ORDER BY fp.frame_id, fp.pair_number
  `).all(...scope.params) as any[];

  const buildings = [...new Set(frames.map((f: any) => f.building).filter(Boolean))] as string[];
  const initialFrameId = Number((await searchParams).frame) || null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="eyebrow">CABLING</div>
          <h2 className="text-2xl font-bold tracking-tight">배선반 관리 (MDF/TPS)</h2>
        </div>
      </div>
      <DistributionView frames={frames} pairs={pairs} buildings={buildings} initialFrameId={initialFrameId} />
    </div>
  );
}

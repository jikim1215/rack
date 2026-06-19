import { getDb } from "@/lib/db";
import { DistributionView } from "./DistributionView";

export default function DistributionPage() {
  const db = getDb();

  const frames = db.prepare(`
    SELECT df.*, l.location_name, l.building, l.floor, l.room
    FROM dist_frames df
    LEFT JOIN locations l ON df.location_id = l.id
    ORDER BY l.building, l.floor, df.frame_name
  `).all() as any[];

  const pairs = db.prepare(`
    SELECT fp.*
    FROM frame_pairs fp
    JOIN dist_frames df ON fp.frame_id = df.id
    ORDER BY fp.frame_id, fp.pair_number
  `).all() as any[];

  const buildings = [...new Set(frames.map((f: any) => f.building).filter(Boolean))] as string[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="eyebrow">CABLING</div>
          <h2 className="text-2xl font-bold tracking-tight">배선반 관리 (MDF/TPS)</h2>
        </div>
      </div>
      <DistributionView frames={frames} pairs={pairs} buildings={buildings} />
    </div>
  );
}

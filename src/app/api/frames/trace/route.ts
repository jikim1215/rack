import { getDb } from "@/lib/db";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";

// ── 선번 추적 (FDF A안 ③) ──
// 무엇으로든 검색: 라벨/케이블ID/출발/도착/사용자/설명, 코어·페어 번호, 프레임명, 연결 장비명/IP.
// 결과는 경로 카드: [장비포트] ─ 프레임A #n ─ (케이블/코어) ─ 프레임B #m ─ [장비포트]
export async function GET(req: NextRequest) {
  const actor = await getActor();
  try { assertCanRead(actor); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json([]);
  const db = getDb();

  const like = `%${q}%`;
  const num = /^\d+$/.test(q) ? Number(q) : null;
  // 소유 전용: 팀은 자기 팀 배선반이 출발인 경로만. 총괄/전체열람은 전체.
  const teamId = actor && actor.role === "team" ? actor.teamId : null;

  const rows = db.prepare(`
    SELECT fp.id, fp.frame_id, fp.pair_number, fp.core_number, fp.status, fp.label, fp.cable_id,
           fp.source, fp.destination, fp.user_info, fp.linked_pair_id,
           df.frame_name, df.frame_type,
           l.building, l.floor,
           lp.pair_number AS linked_pair_number, lp.status AS linked_status,
           lf.id AS linked_frame_id, lf.frame_name AS linked_frame_name,
           pa.port_number AS a_port_number, pa.port_name AS a_port_name,
           aa.id AS a_asset_id, aa.asset_name AS a_asset_name, aa.ip_address AS a_asset_ip,
           pb.port_number AS b_port_number, pb.port_name AS b_port_name,
           ab.id AS b_asset_id, ab.asset_name AS b_asset_name, ab.ip_address AS b_asset_ip
    FROM frame_pairs fp
    JOIN dist_frames df ON fp.frame_id = df.id
    LEFT JOIN locations l ON df.location_id = l.id
    LEFT JOIN frame_pairs lp ON fp.linked_pair_id = lp.id
    LEFT JOIN dist_frames lf ON lp.frame_id = lf.id
    LEFT JOIN ports pa ON fp.connected_port_id = pa.id
    LEFT JOIN assets aa ON pa.asset_id = aa.id
    LEFT JOIN ports pb ON lp.connected_port_id = pb.id
    LEFT JOIN assets ab ON pb.asset_id = ab.id
    WHERE (@teamId IS NULL OR df.team_id = @teamId)
      AND (
        fp.label LIKE @like OR fp.cable_id LIKE @like OR fp.source LIKE @like
        OR fp.destination LIKE @like OR fp.user_info LIKE @like OR fp.description LIKE @like
        OR df.frame_name LIKE @like OR lf.frame_name LIKE @like
        OR aa.asset_name LIKE @like OR aa.ip_address LIKE @like
        OR ab.asset_name LIKE @like OR ab.ip_address LIKE @like
        OR (@num IS NOT NULL AND (fp.core_number = @num OR fp.pair_number = @num))
      )
    ORDER BY df.frame_name, fp.pair_number
    LIMIT 100
  `).all({ like, num, teamId });

  // 링크 쌍 중복 제거: 양쪽 모두 매칭되면 낮은 id 쪽만 대표로
  const seen = new Set<number>();
  const out = (rows as any[]).filter((r) => {
    if (r.linked_pair_id && seen.has(r.linked_pair_id)) return false;
    seen.add(r.id);
    return true;
  });

  return NextResponse.json(out.slice(0, 50));
}

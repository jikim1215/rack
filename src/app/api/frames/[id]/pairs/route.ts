import { getDb } from "@/lib/db";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, assertCanWrite } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

// 페어 조회: 대향(링크) 페어·프레임, 연결 장비 포트까지 조인해 선번장 한 줄을 완성한다.
const PAIRS_SQL = `
  SELECT fp.*,
    lp.pair_number AS linked_pair_number, lp.frame_id AS linked_frame_id,
    lf.frame_name AS linked_frame_name,
    p.port_number AS connected_port_number, p.port_name AS connected_port_name,
    a.id AS connected_asset_id, a.asset_name AS connected_asset_name
  FROM frame_pairs fp
  LEFT JOIN frame_pairs lp ON fp.linked_pair_id = lp.id
  LEFT JOIN dist_frames lf ON lp.frame_id = lf.id
  LEFT JOIN ports p ON fp.connected_port_id = p.id
  LEFT JOIN assets a ON p.asset_id = a.id
  WHERE fp.frame_id = ?
  ORDER BY fp.pair_number
`;

// 감사 diff 대상 필드 (upsert가 갱신하는 컬럼과 동일)
const DIFF_FIELDS = [
  "status", "label", "source", "destination", "cable_id",
  "user_info", "description", "core_number", "connected_port_id",
] as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getActor();
  try { assertCanRead(actor); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const { id } = await params;
  const db = getDb();
  const frame = db.prepare("SELECT team_id FROM dist_frames WHERE id = ?").get(Number(id)) as any;
  if (!frame) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // 소유 전용: 팀은 자기 팀 배선반만.
  if (actor && actor.role === "team" && frame.team_id !== actor.teamId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(db.prepare(PAIRS_SQL).all(Number(id)));
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getActor();
  const { id } = await params;
  const db0 = getDb();
  const frameOwner = db0.prepare("SELECT team_id FROM dist_frames WHERE id = ?").get(Number(id)) as any;
  if (!frameOwner) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try { assertCanWrite(actor, frameOwner.team_id ?? null); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const body = await req.json();
  // 하위호환: 배열 또는 { pairs: [...] } 둘 다 허용 (기존 UI는 배열을 보냈다)
  const pairs: any[] = Array.isArray(body) ? body : Array.isArray(body?.pairs) ? body.pairs : [];
  const db = getDb();

  // 기존 페어를 미리 읽어 변경된 필드만 감사 로그로 남긴다 (전량 upsert여도 로그는 실변경분만).
  const existingPairs = db.prepare(
    "SELECT * FROM frame_pairs WHERE frame_id = ?"
  ).all(Number(id)) as any[];
  const byNumber = new Map<number, any>(existingPairs.map((p) => [Number(p.pair_number), p]));
  const oldValues: Record<string, any> = {};
  const newValues: Record<string, any> = {};

  // linked_pair_id는 여기서 받지 않는다 — 대칭 불변식은 /api/frames/pairs/link 전용.
  const updatePairs = db.transaction(() => {
    const upsert = db.prepare(`
      INSERT INTO frame_pairs (frame_id, pair_number, status, label, source, destination, cable_id, user_info, description, core_number, connected_port_id)
      VALUES (@frame_id, @pair_number, @status, @label, @source, @destination, @cable_id, @user_info, @description, @core_number, @connected_port_id)
      ON CONFLICT(frame_id, pair_number) DO UPDATE SET
        status = excluded.status,
        label = excluded.label,
        source = excluded.source,
        destination = excluded.destination,
        cable_id = excluded.cable_id,
        user_info = excluded.user_info,
        description = excluded.description,
        core_number = excluded.core_number,
        connected_port_id = excluded.connected_port_id
    `);
    for (const pair of pairs) {
      if (!pair.pair_number) continue;
      const row: Record<string, any> = {
        frame_id: Number(id),
        pair_number: Number(pair.pair_number),
        status: pair.status || "unused",
        label: pair.label || "",
        source: pair.source || "",
        destination: pair.destination || "",
        cable_id: pair.cable_id || "",
        user_info: pair.user_info || "",
        description: pair.description || "",
        core_number: pair.core_number == null || pair.core_number === "" ? null : Number(pair.core_number),
        connected_port_id: pair.connected_port_id == null || pair.connected_port_id === "" ? null : Number(pair.connected_port_id),
      };
      // 변경 필드 수집 — logAudit과 동일한 비교 규칙(null/"" 동일 취급)
      const prev = (byNumber.get(row.pair_number) || {}) as Record<string, any>;
      for (const f of DIFF_FIELDS) {
        if (String(prev[f] ?? "") !== String(row[f] ?? "")) {
          oldValues[`pair_${row.pair_number}_${f}`] = prev[f] ?? "";
          newValues[`pair_${row.pair_number}_${f}`] = row[f];
        }
      }
      upsert.run(row);
    }
  });
  updatePairs();

  // 변경된 페어가 있을 때만 한 건으로 기록 (변경 없으면 미기록)
  if (Object.keys(newValues).length > 0) {
    const frame = db.prepare("SELECT frame_name FROM dist_frames WHERE id = ?")
      .get(Number(id)) as { frame_name?: string } | undefined;
    logAudit(db, {
      entityType: "frame",
      entityId: Number(id),
      entityName: frame?.frame_name || `배선반 #${id}`,
      action: "update",
      changedBy: actor?.username || "system",
      oldData: oldValues,
      newData: newValues,
    });
  }

  return NextResponse.json(db.prepare(PAIRS_SQL).all(Number(id)));
}

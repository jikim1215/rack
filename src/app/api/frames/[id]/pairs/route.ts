import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { oneOf, int, idOrNull, str, pathId } from "@/lib/validation/input";
import type { DistFrameRow, FramePairRow } from "@/lib/db-types";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

const PAIR_STATUSES = ["used", "unused", "reserved", "faulty"] as const;

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

type PairRowJoined = FramePairRow & {
  linked_pair_number: number | null;
  linked_frame_id: number | null;
  linked_frame_name: string | null;
  connected_port_number: number | null;
  connected_port_name: string | null;
  connected_asset_id: number | null;
  connected_asset_name: string | null;
};

// 감사 diff 대상 필드 (upsert가 갱신하는 컬럼과 동일)
const DIFF_FIELDS = [
  "status", "label", "source", "destination", "cable_id",
  "user_info", "description", "core_number", "connected_port_id",
] as const;

export const GET = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuAccess(actor, "distribution");
  const id = pathId((await params).id);
  const db = getDb();
  const frame = db.prepare("SELECT team_id FROM dist_frames WHERE id = ?").get(id) as Pick<DistFrameRow, "team_id"> | undefined;
  if (!frame) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // 소유 전용: 팀은 자기 팀 배선반만.
  if (actor.role === "team" && frame.team_id !== actor.teamId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(db.prepare(PAIRS_SQL).all(id) as PairRowJoined[]);
});

export const PUT = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "distribution");
  const id = pathId((await params).id);
  const db0 = getDb();
  const frameOwner = db0.prepare("SELECT team_id FROM dist_frames WHERE id = ?").get(id) as Pick<DistFrameRow, "team_id"> | undefined;
  if (!frameOwner) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertCanWrite(actor, frameOwner.team_id ?? null);
  const body = (await readJson(req)) as unknown[] | { pairs?: unknown };
  // 하위호환: 배열 또는 { pairs: [...] } 둘 다 허용 (기존 UI는 배열을 보냈다)
  const rawPairs: Record<string, unknown>[] = Array.isArray(body) ? (body as Record<string, unknown>[]) : Array.isArray(body?.pairs) ? (body.pairs as Record<string, unknown>[]) : [];
  const db = getDb();

  // 기존 페어를 미리 읽어 변경된 필드만 감사 로그로 남긴다 (전량 upsert여도 로그는 실변경분만).
  const existingPairs = db.prepare(
    "SELECT * FROM frame_pairs WHERE frame_id = ?"
  ).all(id) as FramePairRow[];
  const byNumber = new Map<number, FramePairRow>(existingPairs.map((p) => [Number(p.pair_number), p]));
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

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
    for (const pair of rawPairs) {
      if (!pair.pair_number) continue;
      const status = oneOf(pair, "status", PAIR_STATUSES, { default: "unused", label: "상태" });
      const row = {
        frame_id: id,
        pair_number: int(pair, "pair_number", { min: 1, required: true, label: "페어 번호" }) as number,
        status,
        label: str(pair, "label", { max: 200 }),
        source: str(pair, "source", { max: 200 }),
        destination: str(pair, "destination", { max: 200 }),
        cable_id: str(pair, "cable_id", { max: 200 }),
        user_info: str(pair, "user_info", { max: 200 }),
        description: str(pair, "description", { max: 2000 }),
        core_number: int(pair, "core_number", { min: 1, label: "코어번호" }),
        connected_port_id: idOrNull(pair, "connected_port_id", "연결 포트"),
      };
      // 변경 필드 수집 — logAudit과 동일한 비교 규칙(null/"" 동일 취급)
      const prev = (byNumber.get(row.pair_number) || {}) as Partial<FramePairRow>;
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
      .get(id) as Pick<DistFrameRow, "frame_name"> | undefined;
    logAudit(db, {
      entityType: "frame",
      entityId: id,
      entityName: frame?.frame_name || `배선반 #${id}`,
      action: "update",
      changedBy: actor.username,
      oldData: oldValues,
      newData: newValues,
    });
  }

  return NextResponse.json(db.prepare(PAIRS_SQL).all(id) as PairRowJoined[]);
});

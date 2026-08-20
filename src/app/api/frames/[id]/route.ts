import { getDb } from "@/lib/db";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, assertCanWrite, assertCanDelete } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getActor();
  try { assertCanRead(actor); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const { id } = await params;
  const db = getDb();

  const frame = db.prepare("SELECT * FROM dist_frames WHERE id = ?").get(Number(id)) as any;
  if (!frame) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // 소유 전용: 팀은 자기 팀 배선반만. 타팀/공유(NULL)은 404.
  if (actor && actor.role === "team" && frame.team_id !== actor.teamId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const pairs = db.prepare(
    "SELECT * FROM frame_pairs WHERE frame_id = ? ORDER BY pair_number"
  ).all(Number(id));

  return NextResponse.json({ ...(frame as any), pairs });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getActor();
  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  const existing = db.prepare("SELECT * FROM dist_frames WHERE id = ?").get(Number(id)) as any;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try { assertCanWrite(actor, existing.team_id ?? null); } catch (e) { const r = authzError(e); if (r) return r; throw e; }

  let ownerTeamId: number | null = existing.team_id ?? null;
  if (actor?.role === "admin" && "team_id" in body) {
    ownerTeamId = body.team_id === "" || body.team_id == null ? null : Number(body.team_id);
    if (ownerTeamId != null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId)) {
      return NextResponse.json({ error: "존재하지 않는 팀입니다." }, { status: 400 });
    }
  }

  // 페어 수 폭주/0 입력 방어: 1~1000으로 클램프 (기본 50)
  const totalPairs = Math.max(1, Math.min(1000, Number(body.total_pairs) || 50));

  const newData = {
    location_id: body.location_id,
    rack_id: body.rack_id || null,
    frame_name: body.frame_name || body.name,
    frame_type: body.frame_type || "110block",
    total_pairs: totalPairs,
    description: body.description || "",
  };

  db.prepare(`
    UPDATE dist_frames SET
      location_id = @location_id,
      rack_id = @rack_id,
      frame_name = @frame_name,
      frame_type = @frame_type,
      total_pairs = @total_pairs,
      description = @description,
      team_id = @team_id
    WHERE id = @id
  `).run({ id: Number(id), ...newData, team_id: ownerTeamId });

  // 변경 필드만 diff로 기록 (logAudit이 동일 값은 자체 필터)
  logAudit(db, {
    entityType: "frame",
    entityId: Number(id),
    entityName: newData.frame_name || existing.frame_name || "",
    action: "update",
    changedBy: actor?.username || "system",
    oldData: {
      location_id: existing.location_id,
      rack_id: existing.rack_id,
      frame_name: existing.frame_name,
      frame_type: existing.frame_type,
      total_pairs: existing.total_pairs,
      description: existing.description,
    },
    newData,
  });

  const frame = db.prepare("SELECT * FROM dist_frames WHERE id = ?").get(Number(id));
  return NextResponse.json(frame);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getActor();
  const { id } = await params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM dist_frames WHERE id = ?").get(Number(id)) as any;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try { assertCanDelete(actor, existing.team_id ?? null); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  db.prepare("DELETE FROM dist_frames WHERE id = ?").run(Number(id));
  if (existing) {
    logAudit(db, {
      entityType: "frame",
      entityId: Number(id),
      entityName: existing.frame_name || "",
      action: "delete",
      changedBy: actor?.username || "system",
      oldData: {
        location_id: existing.location_id,
        rack_id: existing.rack_id,
        frame_name: existing.frame_name,
        frame_type: existing.frame_type,
        total_pairs: existing.total_pairs,
        description: existing.description,
      },
    });
  }
  return NextResponse.json({ ok: true });
}

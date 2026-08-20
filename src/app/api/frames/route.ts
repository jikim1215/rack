import { getDb } from "@/lib/db";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, assertCanWrite, scopeWhere } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const actor = await getActor();
  try { assertCanRead(actor); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const db = getDb();
  // 소유 전용(team_id): 팀은 자기 팀 배선반만. 총괄/전체열람은 전체.
  const scope = scopeWhere(actor, "df.team_id");
  const frames = db.prepare(`
    SELECT df.*, l.location_name, l.building, l.floor, t.team_name AS owner_team_name
    FROM dist_frames df
    LEFT JOIN locations l ON df.location_id = l.id
    LEFT JOIN teams t ON df.team_id = t.id
    WHERE ${scope.sql}
    ORDER BY l.building, l.floor, df.frame_name
  `).all(...scope.params);
  return NextResponse.json(frames);
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  const body = await req.json();
  const ownerTeamId =
    actor?.role === "team"
      ? actor.teamId
      : body.team_id === "" || body.team_id == null
        ? null
        : Number(body.team_id);
  try { assertCanWrite(actor, ownerTeamId); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const db = getDb();
  if (ownerTeamId != null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId)) {
    return NextResponse.json({ error: "존재하지 않는 팀입니다." }, { status: 400 });
  }

  // 페어 수 폭주/0 입력 방어: 1~1000으로 클램프 (기본 50)
  const totalPairs = Math.max(1, Math.min(1000, Number(body.total_pairs) || 50));

  const insert = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO dist_frames (location_id, rack_id, frame_name, frame_type, total_pairs, description, team_id)
      VALUES (@location_id, @rack_id, @frame_name, @frame_type, @total_pairs, @description, @team_id)
    `).run({
      location_id: body.location_id,
      rack_id: body.rack_id || null,
      frame_name: body.frame_name || body.name,
      frame_type: body.frame_type || "110block",
      total_pairs: totalPairs,
      description: body.description || "",
      team_id: ownerTeamId,
    });

    const frameId = result.lastInsertRowid;

    const insertPair = db.prepare(`
      INSERT INTO frame_pairs (frame_id, pair_number) VALUES (?, ?)
    `);
    for (let i = 1; i <= totalPairs; i++) {
      insertPair.run(frameId, i);
    }

    return frameId;
  });

  const frameId = insert();

  logAudit(db, {
    entityType: "frame",
    entityId: Number(frameId),
    entityName: body.frame_name || body.name || "",
    action: "create",
    changedBy: actor?.username || "system",
    newData: {
      location_id: body.location_id,
      rack_id: body.rack_id || null,
      frame_name: body.frame_name || body.name,
      frame_type: body.frame_type || "110block",
      total_pairs: totalPairs,
      description: body.description || "",
    },
  });

  const frame = db.prepare("SELECT * FROM dist_frames WHERE id = ?").get(frameId);
  return NextResponse.json(frame, { status: 201 });
}

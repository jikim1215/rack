import { getDb } from "@/lib/db";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanWrite, assertCanDelete } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  const existing = db.prepare("SELECT * FROM locations WHERE id = ?").get(Number(id)) as any;
  if (!existing) return NextResponse.json({ error: "위치를 찾을 수 없습니다." }, { status: 404 });
  // 소유 팀 기준 쓰기 권한: 팀은 자기 소유 위치만. 공유(NULL) 위치는 총괄만.
  try { assertCanWrite(actor, existing.team_id ?? null); } catch (e) { const r = authzError(e); if (r) return r; throw e; }

  // 소유 팀 변경은 총괄만.
  let ownerTeamId: number | null = existing.team_id ?? null;
  if (actor?.role === "admin" && "team_id" in body) {
    ownerTeamId = body.team_id === "" || body.team_id == null ? null : Number(body.team_id);
    if (ownerTeamId != null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId)) {
      return NextResponse.json({ error: "존재하지 않는 팀입니다." }, { status: 400 });
    }
  }

  db.prepare(
    "UPDATE locations SET location_name = @location_name, building = @building, floor = @floor, room = @room, team_id = @team_id WHERE id = @id"
  ).run({
    id: Number(id),
    location_name: body.location_name || body.name,
    building: body.building || "",
    floor: body.floor || "",
    room: body.room || "",
    team_id: ownerTeamId,
  });
  const loc = db.prepare(`
    SELECT l.*, t.team_name AS owner_team_name
    FROM locations l LEFT JOIN teams t ON l.team_id = t.id WHERE l.id = ?
  `).get(Number(id));
  return NextResponse.json(loc);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM locations WHERE id = ?").get(Number(id)) as any;
  if (!existing) return NextResponse.json({ error: "위치를 찾을 수 없습니다." }, { status: 404 });
  try { assertCanDelete(actor, existing.team_id ?? null); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  db.prepare("DELETE FROM locations WHERE id = ?").run(Number(id));
  return NextResponse.json({ ok: true });
}

import { getDb } from "@/lib/db";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, assertCanWrite, locationScopeWhere } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const actor = await getActor();
  try { assertCanRead(actor); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const db = getDb();
  // 행 제한: 소유(team_id) OR 내게 보이는 랙/대역/배선이 있는 위치 (하이브리드). 총괄/전체열람은 전체.
  const scope = locationScopeWhere(actor, "l.team_id", "l.id");
  const locations = db.prepare(`
    SELECT l.*, t.team_name AS owner_team_name
    FROM locations l
    LEFT JOIN teams t ON l.team_id = t.id
    WHERE ${scope.sql}
    ORDER BY l.location_name
  `).all(...scope.params);
  return NextResponse.json(locations);
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  const body = await req.json();
  // team 계정은 자기 팀 소유로만 생성(외부 IDC 등 독립 위치). admin은 지정/미지정(공유=NULL) 자유.
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
  const result = db.prepare(
    "INSERT INTO locations (location_name, building, floor, room, team_id) VALUES (@location_name, @building, @floor, @room, @team_id)"
  ).run({
    location_name: body.location_name || body.name,
    building: body.building || "",
    floor: body.floor || "",
    room: body.room || "",
    team_id: ownerTeamId,
  });
  const loc = db.prepare(`
    SELECT l.*, t.team_name AS owner_team_name, 0 as rack_count, 0 as asset_count
    FROM locations l LEFT JOIN teams t ON l.team_id = t.id WHERE l.id = ?
  `).get(result.lastInsertRowid);
  return NextResponse.json(loc, { status: 201 });
}

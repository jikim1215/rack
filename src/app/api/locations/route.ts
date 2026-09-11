import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, locationScopeWhere } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { asBody, str, int, ValidationError } from "@/lib/validation/input";
import type { LocationRow } from "@/lib/db-types";

export const GET = withApi(async (_req: NextRequest) => {
  const actor = await getActor();
  assertMenuAccess(actor, "locations");
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
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "locations");
  const b = asBody(await readJson(req));
  // 과거 클라이언트 호환: location_name 없이 name 으로 보내는 경우를 흡수
  if ((b.location_name === undefined || b.location_name === null || b.location_name === "") && b.name != null) {
    b.location_name = b.name;
  }
  const location_name = str(b, "location_name", { required: true, max: 100, label: "위치명" });
  const building = str(b, "building", { max: 100 });
  const floor = str(b, "floor", { max: 100 });
  const room = str(b, "room", { max: 100 });
  const sort_order = int(b, "sort_order", { default: 999 });
  // team 계정은 자기 팀 소유로만 생성(외부 IDC 등 독립 위치). admin은 지정/미지정(공유=NULL) 자유.
  const ownerTeamId =
    actor.role === "team"
      ? actor.teamId
      : b.team_id === "" || b.team_id == null
        ? null
        : Number(b.team_id);
  if (ownerTeamId !== null && !Number.isInteger(ownerTeamId)) throw new ValidationError("소유 팀이 올바르지 않습니다.");
  assertCanWrite(actor, ownerTeamId);
  const db = getDb();
  if (ownerTeamId != null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId)) {
    throw new ValidationError("존재하지 않는 팀입니다.");
  }
  const result = db.prepare(
    "INSERT INTO locations (location_name, building, floor, room, sort_order, team_id) VALUES (@location_name, @building, @floor, @room, @sort_order, @team_id)"
  ).run({ location_name, building, floor, room, sort_order, team_id: ownerTeamId });
  const loc = db.prepare(`
    SELECT l.*, t.team_name AS owner_team_name, 0 as rack_count, 0 as asset_count
    FROM locations l LEFT JOIN teams t ON l.team_id = t.id WHERE l.id = ?
  `).get(result.lastInsertRowid) as LocationRow & { owner_team_name: string | null; rack_count: number; asset_count: number };
  return NextResponse.json(loc, { status: 201 });
});

import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuWrite, assertCanWrite, assertCanDelete } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { asBody, str, int, pathId, ValidationError } from "@/lib/validation/input";
import type { LocationRow } from "@/lib/db-types";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "locations");
  const id = pathId((await params).id);
  const b = asBody(await readJson(req));
  if ((b.location_name === undefined || b.location_name === null || b.location_name === "") && b.name != null) {
    b.location_name = b.name;
  }
  const db = getDb();
  const existing = db.prepare("SELECT * FROM locations WHERE id = ?").get(id) as LocationRow | undefined;
  if (!existing) return NextResponse.json({ error: "위치를 찾을 수 없습니다." }, { status: 404 });
  // 소유 팀 기준 쓰기 권한: 팀은 자기 소유 위치만. 공유(NULL) 위치는 총괄만.
  assertCanWrite(actor, existing.team_id ?? null);

  const location_name = str(b, "location_name", { required: true, max: 100, label: "위치명" });
  const building = str(b, "building", { max: 100 });
  const floor = str(b, "floor", { max: 100 });
  const room = str(b, "room", { max: 100 });
  const sort_order = int(b, "sort_order", { default: existing.sort_order });

  // 소유 팀 변경은 총괄만.
  let ownerTeamId: number | null = existing.team_id ?? null;
  if (actor.role === "admin" && "team_id" in b) {
    ownerTeamId = b.team_id === "" || b.team_id == null ? null : Number(b.team_id);
    if (ownerTeamId !== null && !Number.isInteger(ownerTeamId)) throw new ValidationError("소유 팀이 올바르지 않습니다.");
    if (ownerTeamId != null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId)) {
      throw new ValidationError("존재하지 않는 팀입니다.");
    }
  }

  db.prepare(
    "UPDATE locations SET location_name = @location_name, building = @building, floor = @floor, room = @room, sort_order = @sort_order, team_id = @team_id WHERE id = @id"
  ).run({ id, location_name, building, floor, room, sort_order, team_id: ownerTeamId });
  const loc = db.prepare(`
    SELECT l.*, t.team_name AS owner_team_name
    FROM locations l LEFT JOIN teams t ON l.team_id = t.id WHERE l.id = ?
  `).get(id) as LocationRow & { owner_team_name: string | null };
  return NextResponse.json(loc);
});

export const DELETE = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "locations");
  const id = pathId((await params).id);
  const db = getDb();
  const existing = db.prepare("SELECT * FROM locations WHERE id = ?").get(id) as LocationRow | undefined;
  if (!existing) return NextResponse.json({ error: "위치를 찾을 수 없습니다." }, { status: 404 });
  assertCanDelete(actor, existing.team_id ?? null);
  db.prepare("DELETE FROM locations WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
});

import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuWrite, assertCanWrite, assertCanDelete } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
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
  logAudit(db, {
    entityType: "location", entityId: id, entityName: location_name, action: "update", changedBy: actor.username,
    oldData: existing, newData: { location_name, building, floor, room, sort_order, team_id: ownerTeamId },
  });
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
  // 랙·배선반은 FK CASCADE 로 함께 삭제된다(타팀 소유 랙·배선 포함, 실장 자산 배치 유실). 암묵 연쇄 삭제를
  //   막기 위해 빈 위치만 삭제한다 — 남아 있으면 409 로 건수를 알려 먼저 이동/삭제하게 한다.
  const deps = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM racks WHERE location_id = @id) AS racks,
      (SELECT COUNT(*) FROM assets a JOIN racks r ON a.rack_id = r.id WHERE r.location_id = @id) AS assets,
      (SELECT COUNT(*) FROM dist_frames WHERE location_id = @id) AS frames
  `).get({ id }) as { racks: number; assets: number; frames: number };
  if (deps.racks > 0 || deps.frames > 0) {
    const parts = [
      deps.racks > 0 ? `랙 ${deps.racks}개` : "",
      deps.assets > 0 ? `실장 자산 ${deps.assets}대` : "",
      deps.frames > 0 ? `배선반 ${deps.frames}개` : "",
    ].filter(Boolean).join(", ");
    return NextResponse.json(
      { error: `이 위치에 ${parts}가 남아 있어 삭제할 수 없습니다. 먼저 다른 위치로 옮기거나 삭제하세요.`, ...deps },
      { status: 409 },
    );
  }
  db.prepare("DELETE FROM locations WHERE id = ?").run(id);
  logAudit(db, { entityType: "location", entityId: id, entityName: existing.location_name, action: "delete", changedBy: actor.username, oldData: existing });
  return NextResponse.json({ ok: true });
});

import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, scopeWhere } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { asBody, str, oneOf, int, idOrNull, ValidationError } from "@/lib/validation/input";
import type { DistFrameRow, LocationRow, TeamRow } from "@/lib/db-types";
import { NextRequest, NextResponse } from "next/server";

const FRAME_TYPES = ["110block", "patch_panel", "optical", "other"] as const;

export const GET = withApi(async () => {
  const actor = await getActor();
  assertMenuAccess(actor, "distribution");
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
  `).all(...scope.params) as (DistFrameRow & { location_name: string | null; building: string | null; floor: string | null; owner_team_name: string | null })[];
  return NextResponse.json(frames);
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "distribution");
  const b = asBody(await readJson(req));
  const db = getDb();

  const ownerTeamId =
    actor.role === "team"
      ? actor.teamId
      : b.team_id === "" || b.team_id == null
        ? null
        : idOrNull(b, "team_id", "소유 팀");
  assertCanWrite(actor, ownerTeamId);
  if (ownerTeamId != null && !(db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId) as TeamRow | undefined)) {
    throw new ValidationError("존재하지 않는 팀입니다.");
  }

  const frameName = str(b, "frame_name", { required: true, max: 100, label: "배선반명" });
  const frameType = oneOf(b, "frame_type", FRAME_TYPES, { default: "110block", label: "유형" });
  const totalPairs = int(b, "total_pairs", { min: 1, max: 2000, default: 50, label: "총페어" }) as number;
  const locationId = int(b, "location_id", { min: 1, required: true, label: "위치" }) as number;
  const rackId = idOrNull(b, "rack_id", "랙");
  const rackUnitStart = int(b, "rack_unit_start", { min: 1, label: "시작 U" });
  const rackUnitSize = int(b, "rack_unit_size", { min: 1, default: 2, label: "U 크기" }) as number;
  const description = str(b, "description", { max: 2000 });

  if (!(db.prepare("SELECT id FROM locations WHERE id = ?").get(locationId) as LocationRow | undefined)) {
    throw new ValidationError("존재하지 않는 위치입니다.");
  }

  const insert = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO dist_frames (location_id, rack_id, frame_name, frame_type, total_pairs, rack_unit_start, rack_unit_size, description, team_id)
      VALUES (@location_id, @rack_id, @frame_name, @frame_type, @total_pairs, @rack_unit_start, @rack_unit_size, @description, @team_id)
    `).run({
      location_id: locationId,
      rack_id: rackId,
      frame_name: frameName,
      frame_type: frameType,
      total_pairs: totalPairs,
      rack_unit_start: rackUnitStart,
      rack_unit_size: rackUnitSize,
      description,
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
    entityName: frameName,
    action: "create",
    changedBy: actor.username,
    newData: {
      location_id: locationId,
      rack_id: rackId,
      frame_name: frameName,
      frame_type: frameType,
      total_pairs: totalPairs,
      description,
    },
  });

  const frame = db.prepare("SELECT * FROM dist_frames WHERE id = ?").get(frameId) as DistFrameRow;
  return NextResponse.json(frame, { status: 201 });
});

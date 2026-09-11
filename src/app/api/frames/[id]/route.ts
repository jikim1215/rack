import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, assertCanDelete } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { asBody, str, oneOf, int, idOrNull, pathId, ValidationError } from "@/lib/validation/input";
import type { DistFrameRow, FramePairRow, LocationRow, TeamRow } from "@/lib/db-types";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

const FRAME_TYPES = ["110block", "patch_panel", "optical", "other"] as const;

export const GET = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuAccess(actor, "distribution");
  const id = pathId((await params).id);
  const db = getDb();

  const frame = db.prepare("SELECT * FROM dist_frames WHERE id = ?").get(id) as DistFrameRow | undefined;
  if (!frame) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // 소유 전용: 팀은 자기 팀 배선반만. 타팀/공유(NULL)은 404.
  if (actor.role === "team" && frame.team_id !== actor.teamId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const pairs = db.prepare(
    "SELECT * FROM frame_pairs WHERE frame_id = ? ORDER BY pair_number"
  ).all(id) as FramePairRow[];

  return NextResponse.json({ ...frame, pairs });
});

export const PUT = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "distribution");
  const id = pathId((await params).id);
  const b = asBody(await readJson(req));
  const db = getDb();

  const existing = db.prepare("SELECT * FROM dist_frames WHERE id = ?").get(id) as DistFrameRow | undefined;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertCanWrite(actor, existing.team_id ?? null);

  let ownerTeamId: number | null = existing.team_id ?? null;
  if (actor.role === "admin" && "team_id" in b) {
    ownerTeamId = b.team_id === "" || b.team_id == null ? null : idOrNull(b, "team_id", "소유 팀");
    if (ownerTeamId != null && !(db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId) as TeamRow | undefined)) {
      throw new ValidationError("존재하지 않는 팀입니다.");
    }
  }

  const frameName = str(b, "frame_name", { required: true, max: 100, label: "배선반명" });
  const frameType = oneOf(b, "frame_type", FRAME_TYPES, { default: "110block", label: "유형" });
  const totalPairs = int(b, "total_pairs", { min: 1, max: 2000, default: 50, label: "총페어" }) as number;
  const locationId = int(b, "location_id", { min: 1, required: true, label: "위치" }) as number;
  const rackId = idOrNull(b, "rack_id", "랙");
  // 실장 U 정보는 본문에 키가 있을 때만 갱신(원본 동작 보존 — 프레임 메타 편집이 실장 위치를 지우지 않게, 비평 반영)
  const rackUnitStart = "rack_unit_start" in b ? int(b, "rack_unit_start", { min: 1, label: "시작 U" }) : existing.rack_unit_start;
  const rackUnitSize = "rack_unit_size" in b ? (int(b, "rack_unit_size", { min: 1, default: 2, label: "U 크기" }) as number) : existing.rack_unit_size;
  const description = str(b, "description", { max: 2000 });

  if (!(db.prepare("SELECT id FROM locations WHERE id = ?").get(locationId) as LocationRow | undefined)) {
    throw new ValidationError("존재하지 않는 위치입니다.");
  }

  const newData = {
    location_id: locationId,
    rack_id: rackId,
    frame_name: frameName,
    frame_type: frameType,
    total_pairs: totalPairs,
    description,
  };

  db.prepare(`
    UPDATE dist_frames SET
      location_id = @location_id,
      rack_id = @rack_id,
      frame_name = @frame_name,
      frame_type = @frame_type,
      total_pairs = @total_pairs,
      rack_unit_start = @rack_unit_start,
      rack_unit_size = @rack_unit_size,
      description = @description,
      team_id = @team_id
    WHERE id = @id
  `).run({ id, ...newData, rack_unit_start: rackUnitStart, rack_unit_size: rackUnitSize, team_id: ownerTeamId });

  // 변경 필드만 diff로 기록 (logAudit이 동일 값은 자체 필터)
  logAudit(db, {
    entityType: "frame",
    entityId: id,
    entityName: newData.frame_name || existing.frame_name || "",
    action: "update",
    changedBy: actor.username,
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

  const frame = db.prepare("SELECT * FROM dist_frames WHERE id = ?").get(id) as DistFrameRow;
  return NextResponse.json(frame);
});

export const DELETE = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "distribution");
  const id = pathId((await params).id);
  const db = getDb();
  const existing = db.prepare("SELECT * FROM dist_frames WHERE id = ?").get(id) as DistFrameRow | undefined;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertCanDelete(actor, existing.team_id ?? null);
  db.prepare("DELETE FROM dist_frames WHERE id = ?").run(id);
  logAudit(db, {
    entityType: "frame",
    entityId: id,
    entityName: existing.frame_name || "",
    action: "delete",
    changedBy: actor.username,
    oldData: {
      location_id: existing.location_id,
      rack_id: existing.rack_id,
      frame_name: existing.frame_name,
      frame_type: existing.frame_type,
      total_pairs: existing.total_pairs,
      description: existing.description,
    },
  });
  return NextResponse.json({ ok: true });
});

import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, scopeWhere, rackScopeWhere } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { asBody, str, int, idOrNull, ValidationError } from "@/lib/validation/input";
import { NextRequest, NextResponse } from "next/server";
import type { RackRow, LocationRow } from "@/lib/db-types";

export const GET = withApi(async (_req: NextRequest) => {
  const actor = await getActor();
  assertMenuAccess(actor, "racks");
  // 행 제한: 소유(team_id) OR 그 랙에 내 팀 자산 존재 (하이브리드). 총괄/전체열람은 전체.
  const rowScope = rackScopeWhere(actor, "r.team_id", "r.id");
  // 개수/사용유닛은 요청자 팀 스코프 기준 (공유 랙에서 각자 자기 자산만 집계 — 타팀 노출 방지).
  const countScope = scopeWhere(actor, "team_id");
  const db = getDb();
  const racks = db.prepare(`
    SELECT r.*, l.location_name, t.team_name AS owner_team_name,
      COALESCE((SELECT COUNT(*) FROM assets WHERE rack_id = r.id AND ${countScope.sql}), 0) as asset_count,
      COALESCE((SELECT SUM(rack_unit_size) FROM assets WHERE rack_id = r.id AND ${countScope.sql}), 0) as used_units
    FROM racks r
    LEFT JOIN locations l ON r.location_id = l.id
    LEFT JOIN teams t ON r.team_id = t.id
    WHERE ${rowScope.sql}
    ORDER BY r.rack_name
  `).all(...countScope.params, ...countScope.params, ...rowScope.params) as (RackRow & {
    location_name: string | null;
    owner_team_name: string | null;
    asset_count: number;
    used_units: number;
  })[];
  return NextResponse.json(racks);
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "racks");
  const b = asBody(await readJson(req));
  // team 계정은 자기 팀 소유로만 생성. admin은 지정/미지정(공유=NULL) 자유. viewer 불가.
  const ownerTeamId = actor.role === "team" ? actor.teamId : idOrNull(b, "team_id", "소유 팀");
  assertCanWrite(actor, ownerTeamId);
  const db = getDb();

  // 입력 검증
  const rackName = str(b, "rack_name", { required: true, max: 100, label: "랙 이름" }).replace(/\s+/g, " ");
  const totalUnits = int(b, "total_units", { min: 1, max: 60, default: 42, label: "총 유닛 수" });
  const description = str(b, "description", { max: 500 });
  const locId = int(b, "location_id", { required: true, min: 1, label: "위치" });

  const loc = db.prepare("SELECT id FROM locations WHERE id = ?").get(locId) as Pick<LocationRow, "id"> | undefined;
  if (!loc) throw new ValidationError("존재하지 않는 위치입니다.");

  if (ownerTeamId != null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId)) {
    throw new ValidationError("존재하지 않는 팀입니다.");
  }

  const dup = db.prepare(
    "SELECT id FROM racks WHERE location_id = ? AND UPPER(rack_name) = UPPER(?)"
  ).get(locId, rackName);
  if (dup) {
    return NextResponse.json({ error: `동일 위치에 '${rackName}' 랙이 이미 존재합니다.` }, { status: 409 });
  }

  const result = db.prepare(
    "INSERT INTO racks (location_id, rack_name, total_units, description, team_id) VALUES (?, ?, ?, ?, ?)"
  ).run(locId, rackName, totalUnits, description, ownerTeamId);

  const rack = db.prepare(`
    SELECT r.*, l.location_name, t.team_name AS owner_team_name, 0 as asset_count, 0 as used_units
    FROM racks r
    LEFT JOIN locations l ON r.location_id = l.id
    LEFT JOIN teams t ON r.team_id = t.id
    WHERE r.id = ?
  `).get(result.lastInsertRowid) as RackRow & {
    location_name: string | null;
    owner_team_name: string | null;
    asset_count: number;
    used_units: number;
  };

  logAudit(db, {
    entityType: "rack", entityId: Number(result.lastInsertRowid), entityName: rackName,
    action: "create", changedBy: actor.username,
    newData: { rack_name: rackName, total_units: totalUnits, location_id: locId, team_id: ownerTeamId },
  });

  return NextResponse.json(rack, { status: 201 });
});

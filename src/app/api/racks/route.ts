import { getDb } from "@/lib/db";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, assertCanWrite, scopeWhere, rackScopeWhere } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const actor = await getActor();
  try { assertCanRead(actor); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
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
  `).all(...countScope.params, ...countScope.params, ...rowScope.params);
  return NextResponse.json(racks);
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  const body = await req.json();
  // team 계정은 자기 팀 소유로만 생성. admin은 지정/미지정(공유=NULL) 자유. viewer 불가.
  const ownerTeamId =
    actor?.role === "team"
      ? actor.teamId
      : body.team_id === "" || body.team_id == null
        ? null
        : Number(body.team_id);
  try { assertCanWrite(actor, ownerTeamId); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const db = getDb();

  // 입력 검증
  const rackName = (body.rack_name || body.name || "").trim().replace(/\s+/g, " ");
  if (!rackName) return NextResponse.json({ error: "랙 이름은 필수입니다." }, { status: 400 });

  const totalUnits = Number(body.total_units) || 42;
  if (totalUnits < 1) return NextResponse.json({ error: "총 유닛 수는 1 이상이어야 합니다." }, { status: 400 });

  const locId = Number(body.location_id);
  const loc = db.prepare("SELECT id FROM locations WHERE id = ?").get(locId);
  if (!loc) return NextResponse.json({ error: "존재하지 않는 위치입니다." }, { status: 400 });

  if (ownerTeamId != null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId)) {
    return NextResponse.json({ error: "존재하지 않는 팀입니다." }, { status: 400 });
  }

  const dup = db.prepare(
    "SELECT id FROM racks WHERE location_id = ? AND UPPER(rack_name) = UPPER(?)"
  ).get(locId, rackName);
  if (dup) {
    return NextResponse.json({ error: `동일 위치에 '${rackName}' 랙이 이미 존재합니다.` }, { status: 409 });
  }

  const result = db.prepare(
    "INSERT INTO racks (location_id, rack_name, total_units, description, team_id) VALUES (?, ?, ?, ?, ?)"
  ).run(locId, rackName, totalUnits, body.description || "", ownerTeamId);

  const rack = db.prepare(`
    SELECT r.*, l.location_name, t.team_name AS owner_team_name, 0 as asset_count, 0 as used_units
    FROM racks r
    LEFT JOIN locations l ON r.location_id = l.id
    LEFT JOIN teams t ON r.team_id = t.id
    WHERE r.id = ?
  `).get(result.lastInsertRowid);

  logAudit(db, {
    entityType: "rack", entityId: Number(result.lastInsertRowid), entityName: rackName,
    action: "create", changedBy: actor?.username || "system",
    newData: { rack_name: rackName, total_units: totalUnits, location_id: locId, team_id: ownerTeamId },
  });

  return NextResponse.json(rack, { status: 201 });
}

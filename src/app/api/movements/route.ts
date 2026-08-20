import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, assertCanWrite, scopeWhere } from "@/lib/authz";

export async function GET() {
  const actor = await getActor();
  try {
    assertCanRead(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }
  // 소유 권위는 연결된 자산의 team_id. team 계정은 자기 팀 자산의 이력만,
  // 자산 미연결(asset_id NULL) 행은 LEFT JOIN 으로 a.team_id=NULL → (NULL=?) falsy 라 자동 제외.
  const scope = scopeWhere(actor, "a.team_id");
  const db = getDb();
  const movements = db.prepare(`
    SELECT m.*, a.asset_name
    FROM asset_movements m
    LEFT JOIN assets a ON m.asset_id = a.id
    WHERE ${scope.sql}
    ORDER BY m.created_at DESC
  `).all(...scope.params);
  return NextResponse.json(movements);
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  const body = await req.json();
  const db = getDb();

  // 연결 자산이 있으면 그 자산의 team_id를 소유 권위로 사용해 권한 검증.
  // 자산 미연결(반입 등) 신규 행은 ownerTeamId 미지정 → 일반 쓰기 권한만 확인(admin/team).
  let ownerTeamId: number | null | undefined = undefined;
  if (body.asset_id != null) {
    const asset = db.prepare("SELECT team_id FROM assets WHERE id = ?").get(Number(body.asset_id)) as { team_id: number | null } | undefined;
    ownerTeamId = asset ? asset.team_id : null;
  }
  try {
    assertCanWrite(actor, ownerTeamId);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const result = db.prepare(`
    INSERT INTO asset_movements (
      movement_type, movement_date, asset_id, requester, approver,
      department, purpose, destination, equipment_desc, serial_number,
      model, size_u, manufacturer, rack_position, power_watts, power_redundant,
      notes, status, created_by
    ) VALUES (
      @movement_type, @movement_date, @asset_id, @requester, @approver,
      @department, @purpose, @destination, @equipment_desc, @serial_number,
      @model, @size_u, @manufacturer, @rack_position, @power_watts, @power_redundant,
      @notes, 'requested', @created_by
    )
  `).run({
    movement_type: body.movement_type,
    movement_date: body.movement_date || "",
    asset_id: body.asset_id || null,
    requester: body.requester || "",
    approver: body.approver || "",
    department: body.department || "",
    purpose: body.purpose || "",
    destination: body.destination || "",
    equipment_desc: body.equipment_desc || "",
    serial_number: body.serial_number || "",
    model: body.model || "",
    size_u: body.size_u || "",
    manufacturer: body.manufacturer || "",
    rack_position: body.rack_position || "",
    power_watts: body.power_watts || "",
    power_redundant: body.power_redundant || "",
    notes: body.notes || "",
    created_by: actor?.username || "system",
  });

  const movement = db.prepare(`
    SELECT m.*, a.asset_name
    FROM asset_movements m
    LEFT JOIN assets a ON m.asset_id = a.id
    WHERE m.id = ?
  `).get(result.lastInsertRowid);

  return NextResponse.json(movement, { status: 201 });
}

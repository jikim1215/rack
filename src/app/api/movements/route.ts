import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, scopeWhere } from "@/lib/authz";
import { asBody, str, oneOf, idOrNull, dateStr, ValidationError } from "@/lib/validation/input";
import type { MovementRow, AssetRow } from "@/lib/db-types";

export const GET = withApi(async () => {
  const actor = await getActor();
  assertMenuAccess(actor, "movements");
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
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "movements");
  const b = asBody(await readJson(req));
  const db = getDb();

  const movement_type = oneOf(b, "movement_type", ["bring_in", "bring_out", "return"] as const, { required: true, label: "반출입 유형" });
  const movement_date = dateStr(b, "movement_date", { label: "반출입 일자" });
  const asset_id = idOrNull(b, "asset_id", "자산");
  const requester = str(b, "requester", { max: 100, label: "신청자" });
  const approver = str(b, "approver", { max: 100, label: "승인자" });
  const department = str(b, "department", { max: 100, label: "부서" });
  const purpose = str(b, "purpose", { max: 500, label: "목적" });
  const destination = str(b, "destination", { max: 200, label: "행선지" });
  const equipment_desc = str(b, "equipment_desc", { max: 300, label: "장비 설명" });
  const serial_number = str(b, "serial_number", { max: 100, label: "시리얼번호" });
  const model = str(b, "model", { max: 100, label: "모델" });
  const size_u = str(b, "size_u", { max: 50, label: "크기(U)" });
  const manufacturer = str(b, "manufacturer", { max: 100, label: "제조사" });
  const rack_position = str(b, "rack_position", { max: 100, label: "랙 위치" });
  const power_watts = str(b, "power_watts", { max: 50, label: "소비전력" });
  const power_redundant = str(b, "power_redundant", { max: 50, label: "전원 이중화" });
  const notes = str(b, "notes", { max: 1000, label: "비고" });

  // 연결 자산이 있으면 그 자산의 team_id를 소유 권위로 사용해 권한 검증.
  // 자산 미연결(반입 등) 신규 행은 ownerTeamId 미지정 → 일반 쓰기 권한만 확인(admin/team).
  let ownerTeamId: number | null | undefined = undefined;
  if (asset_id != null) {
    const asset = db.prepare("SELECT team_id FROM assets WHERE id = ?").get(asset_id) as Pick<AssetRow, "team_id"> | undefined;
    if (!asset) throw new ValidationError("존재하지 않는 자산입니다.");
    ownerTeamId = asset.team_id;
  }
  assertCanWrite(actor, ownerTeamId);

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
    movement_type,
    movement_date,
    asset_id,
    requester,
    approver,
    department,
    purpose,
    destination,
    equipment_desc,
    serial_number,
    model,
    size_u,
    manufacturer,
    rack_position,
    power_watts,
    power_redundant,
    notes,
    created_by: actor.username,
  });

  const movement = db.prepare(`
    SELECT m.*, a.asset_name
    FROM asset_movements m
    LEFT JOIN assets a ON m.asset_id = a.id
    WHERE m.id = ?
  `).get(result.lastInsertRowid) as (MovementRow & { asset_name: string | null }) | undefined;

  return NextResponse.json(movement, { status: 201 });
});

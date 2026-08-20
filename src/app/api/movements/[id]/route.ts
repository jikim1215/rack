import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanWrite, assertCanDelete } from "@/lib/authz";
import { logAudit, logAssetChange } from "@/lib/audit";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const actor = await getActor();
  const db = getDb();

  const movement = db.prepare('SELECT * FROM asset_movements WHERE id = ?').get(Number(id)) as any;
  if (!movement) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // 소유 권위는 연결 자산의 team_id. 자산 미연결 행은 null → team 계정 쓰기 불가.
  const asset = movement.asset_id != null
    ? db.prepare("SELECT team_id FROM assets WHERE id = ?").get(movement.asset_id) as { team_id: number | null } | undefined
    : undefined;
  const ownerTeamId = movement.asset_id != null ? (asset ? asset.team_id : null) : null;
  try {
    assertCanWrite(actor, ownerTeamId);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const body = await req.json();

  // 승인/반려는 menu_permissions(menu_key='movements', can_approve=1) 보유 역할만.
  // admin은 항상 허용(시드상 can_approve=1이지만 권한 행 누락에 대비해 방어적으로 통과).
  if (body.status === "approved" || body.status === "rejected") {
    const canApprove =
      actor.role === "admin" ||
      !!db.prepare(
        "SELECT 1 FROM menu_permissions WHERE menu_key = 'movements' AND role = ? AND can_approve = 1"
      ).get(actor.role);
    if (!canApprove) {
      return NextResponse.json(
        { error: "승인/반려 권한이 없습니다" },
        { status: 403 }
      );
    }
  }

  const updates: string[] = [];
  const values: Record<string, unknown> = { id: Number(id) };

  if (body.status) {
    updates.push("status = @status");
    values.status = body.status;
  }
  if (body.status === "approved" || body.status === "rejected") {
    updates.push("approver = @approver");
    values.approver = actor.username;
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No updates" }, { status: 400 });
  }

  db.prepare(
    `UPDATE asset_movements SET ${updates.join(", ")} WHERE id = @id`
  ).run(values);

  // 반출 완료 → 자산 예비(standby) + 랙 슬롯 해제 (이전 배치는 oldData에 남겨 복원 가능하게)
  if (body.status === 'completed' && movement?.movement_type === 'bring_out' && movement.asset_id) {
    const prev = db.prepare(
      'SELECT id, asset_name, status, rack_id, rack_unit_start FROM assets WHERE id = ?'
    ).get(movement.asset_id) as any;
    db.prepare('UPDATE assets SET status = ?, rack_id = NULL, rack_unit_start = NULL WHERE id = ?')
      .run('standby', movement.asset_id);
    if (prev) {
      logAssetChange(db, {
        assetId: prev.id,
        assetName: prev.asset_name,
        action: 'update',
        changedBy: actor.username,
        oldData: { status: prev.status, rack_id: prev.rack_id, rack_unit_start: prev.rack_unit_start },
        // 원인 상관관계 명시 (외부 검토 R8-5 합의): 이 update가 반출 완료의 자동 후속처리임을 로그만 봐도 알 수 있게
        newData: { status: 'standby', rack_id: null, rack_unit_start: null, _cause: `반출 완료(#${movement.id})에 따른 자동 해제` },
      });
    }
  }

  // 반납 완료 → 자산 active 복원
  if (body.status === 'completed' && movement?.movement_type === 'return' && movement.asset_id) {
    const prev = db.prepare('SELECT id, asset_name, status FROM assets WHERE id = ?').get(movement.asset_id) as any;
    db.prepare('UPDATE assets SET status = ? WHERE id = ?').run('active', movement.asset_id);
    if (prev) {
      logAssetChange(db, {
        assetId: prev.id,
        assetName: prev.asset_name,
        action: 'update',
        changedBy: actor.username,
        oldData: { status: prev.status },
        newData: { status: 'active' },
      });
    }
  }

  // 반입 완료 + 기존 자산 연결 → 자산 재활성 (반출→standby 후 재반입 등 라이프사이클 복원)
  if (body.status === 'completed' && movement?.movement_type === 'bring_in' && movement.asset_id) {
    const prev = db.prepare('SELECT id, asset_name, status FROM assets WHERE id = ?').get(movement.asset_id) as any;
    if (prev && prev.status !== 'active') {
      db.prepare("UPDATE assets SET status = 'active' WHERE id = ?").run(movement.asset_id);
      logAssetChange(db, {
        assetId: prev.id,
        assetName: prev.asset_name,
        action: 'update',
        changedBy: actor.username,
        oldData: { status: prev.status },
        newData: { status: 'active', _cause: `반입 완료(#${movement.id})에 따른 자동 재활성` },
      });
    }
  }

  // 반입 완료 + 자산 미연결(직접입력) → 자산 대장 자동 등록.
  //   신청자가 기재한 물리정보(품목/제조사/모델/크기/시리얼/부서)를 그대로 대장에 매핑 = 데이터 연계.
  //   전력(소비전력/이중화)·희망 랙위치는 assets에 전용 컬럼이 없어 description에 보존(무손실).
  if (body.status === 'completed' && movement?.movement_type === 'bring_in' && !movement.asset_id) {
    const newAssetName = movement.equipment_desc || movement.model || '반입 장비';
    // 크기 "2U"/"2" → 정수 rack_unit_size (미상/0 이하는 기본 1U)
    const sizeNum = parseInt(String(movement.size_u ?? '').replace(/[^0-9]/g, ''), 10);
    const rackUnitSize = Number.isFinite(sizeNum) && sizeNum > 0 ? sizeNum : 1;
    const powerNote =
      movement.power_redundant === 'yes' ? '전원 이중화'
        : movement.power_redundant === 'no' ? '단일 전원' : '';
    const description = [
      movement.purpose,
      movement.power_watts ? `소비전력 ${movement.power_watts}` : '',
      powerNote,
      movement.rack_position ? `반입 희망 랙위치 ${movement.rack_position}` : '',
      movement.notes,
    ].filter(Boolean).join(' · ');

    const newAsset = db.prepare(`
      INSERT INTO assets (asset_type, asset_name, manufacturer, model, serial_number,
        status, department, rack_unit_size, description)
      VALUES ('other', @asset_name, @manufacturer, @model, @serial_number,
        'active', @department, @rack_unit_size, @description)
    `).run({
      asset_name: newAssetName,
      manufacturer: movement.manufacturer || '',
      model: movement.model || '',
      serial_number: movement.serial_number || '',
      department: movement.department || '',
      rack_unit_size: rackUnitSize,
      description,
    });
    db.prepare('UPDATE asset_movements SET asset_id = ? WHERE id = ?').run(newAsset.lastInsertRowid, Number(id));
    logAssetChange(db, {
      assetId: Number(newAsset.lastInsertRowid),
      assetName: newAssetName,
      action: 'create',
      changedBy: actor.username,
      newData: {
        asset_type: 'other',
        asset_name: newAssetName,
        manufacturer: movement.manufacturer || '',
        model: movement.model || '',
        serial_number: movement.serial_number || '',
        status: 'active',
        department: movement.department || '',
        rack_unit_size: rackUnitSize,
        description,
        _cause: `반입 완료(#${movement.id}) 직접입력 장비의 자산 대장 자동 등록`,
      },
    });
  }

  const updated = db.prepare(`
    SELECT m.*, a.asset_name
    FROM asset_movements m
    LEFT JOIN assets a ON m.asset_id = a.id
    WHERE m.id = ?
  `).get(Number(id));

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const actor = await getActor();
  const db = getDb();

  const movement = db.prepare('SELECT * FROM asset_movements WHERE id = ?').get(Number(id)) as any;
  if (!movement) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const asset = movement.asset_id != null
    ? db.prepare("SELECT team_id FROM assets WHERE id = ?").get(movement.asset_id) as { team_id: number | null } | undefined
    : undefined;
  const ownerTeamId = movement.asset_id != null ? (asset ? asset.team_id : null) : null;
  try {
    assertCanDelete(actor, ownerTeamId);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  db.prepare("DELETE FROM asset_movements WHERE id = ?").run(Number(id));
  logAudit(db, {
    entityType: "movement",
    entityId: Number(id),
    entityName: movement.equipment_desc || `반출입 #${id}`,
    action: "delete",
    changedBy: actor.username,
    oldData: {
      movement_type: movement.movement_type,
      status: movement.status,
      asset_id: movement.asset_id,
      serial_number: movement.serial_number,
      purpose: movement.purpose,
    },
  });
  return NextResponse.json({ success: true });
}

import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuWrite, assertMenuApprove, assertCanWrite, assertCanDelete } from "@/lib/authz";
import { logAudit, logAssetChange } from "@/lib/audit";
import { asBody, pathId, oneOf } from "@/lib/validation/input";
import type { MovementRow, AssetRow } from "@/lib/db-types";
import { registerBroughtInAsset } from "@/lib/movement-complete";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withApi(async (req: NextRequest, { params }: Ctx) => {
  const id = pathId((await params).id);
  const actor = await getActor();
  assertMenuWrite(actor, "movements");
  const db = getDb();

  const movement = db.prepare('SELECT * FROM asset_movements WHERE id = ?').get(id) as MovementRow | undefined;
  if (!movement) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // 소유 권위는 연결 자산의 team_id. 자산 미연결 행은 null → team 계정 쓰기 불가.
  const asset = movement.asset_id != null
    ? db.prepare("SELECT team_id FROM assets WHERE id = ?").get(movement.asset_id) as Pick<AssetRow, "team_id"> | undefined
    : undefined;
  const ownerTeamId = movement.asset_id != null ? (asset ? asset.team_id : null) : null;
  assertCanWrite(actor, ownerTeamId);

  const b = asBody(await readJson(req));
  const status = b.status === undefined ? undefined : oneOf(b, "status", ["requested", "approved", "completed", "rejected"] as const, { label: "상태" });

  // 승인/반려는 menu_permissions(menu_key='movements', can_approve=1) 보유 역할만. admin은 자동 통과.
  if (status === "approved" || status === "rejected") {
    assertMenuApprove(actor, "movements");
  }

  const updates: string[] = [];
  const values: Record<string, unknown> = { id };

  if (status) {
    updates.push("status = @status");
    values.status = status;
  }
  if (status === "approved" || status === "rejected") {
    updates.push("approver = @approver");
    values.approver = actor.username;
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No updates" }, { status: 400 });
  }

  // 상태 변경과 자동 후속처리(자산 상태·대장 등록)는 한 트랜잭션 — 후속처리가 실패하면 상태 변경도 되돌린다.
  db.transaction(() => {
    db.prepare(
      `UPDATE asset_movements SET ${updates.join(", ")} WHERE id = @id`
    ).run(values);

    // 반출 완료 → 자산 예비(standby) + 랙 슬롯 해제 (이전 배치는 oldData에 남겨 복원 가능하게)
    if (status === 'completed' && movement.movement_type === 'bring_out' && movement.asset_id) {
      const prev = db.prepare(
        'SELECT id, asset_name, status, rack_id, rack_unit_start, rack_side FROM assets WHERE id = ?'
      ).get(movement.asset_id) as Pick<AssetRow, "id" | "asset_name" | "status" | "rack_id" | "rack_unit_start" | "rack_side"> | undefined;
      db.prepare('UPDATE assets SET status = ?, rack_id = NULL, rack_unit_start = NULL, rack_side = NULL WHERE id = ?')
        .run('standby', movement.asset_id);
      if (prev) {
        logAssetChange(db, {
          assetId: prev.id,
          assetName: prev.asset_name,
          action: 'update',
          changedBy: actor.username,
          oldData: { status: prev.status, rack_id: prev.rack_id, rack_unit_start: prev.rack_unit_start, rack_side: prev.rack_side },
          // 원인 상관관계 명시 (외부 검토 R8-5 합의): 이 update가 반출 완료의 자동 후속처리임을 로그만 봐도 알 수 있게
          newData: { status: 'standby', rack_id: null, rack_unit_start: null, rack_side: null, _cause: `반출 완료(#${movement.id})에 따른 자동 해제` },
        });
      }
    }

    // 반납 완료 → 자산 active 복원
    if (status === 'completed' && movement.movement_type === 'return' && movement.asset_id) {
      const prev = db.prepare('SELECT id, asset_name, status FROM assets WHERE id = ?').get(movement.asset_id) as Pick<AssetRow, "id" | "asset_name" | "status"> | undefined;
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
    if (status === 'completed' && movement.movement_type === 'bring_in' && movement.asset_id) {
      const prev = db.prepare('SELECT id, asset_name, status FROM assets WHERE id = ?').get(movement.asset_id) as Pick<AssetRow, "id" | "asset_name" | "status"> | undefined;
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

    // 반입 완료 + 자산 미연결(직접입력) → 자산 대장 자동 등록 (lib/movement-complete.ts)
    if (status === 'completed' && movement.movement_type === 'bring_in' && !movement.asset_id) {
      registerBroughtInAsset(db, movement, actor.username);
    }
  })();

  const updated = db.prepare(`
    SELECT m.*, a.asset_name
    FROM asset_movements m
    LEFT JOIN assets a ON m.asset_id = a.id
    WHERE m.id = ?
  `).get(id) as (MovementRow & { asset_name: string | null }) | undefined;

  return NextResponse.json(updated);
});

export const DELETE = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const id = pathId((await params).id);
  const actor = await getActor();
  assertMenuWrite(actor, "movements");
  const db = getDb();

  const movement = db.prepare('SELECT * FROM asset_movements WHERE id = ?').get(id) as MovementRow | undefined;
  if (!movement) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const asset = movement.asset_id != null
    ? db.prepare("SELECT team_id FROM assets WHERE id = ?").get(movement.asset_id) as Pick<AssetRow, "team_id"> | undefined
    : undefined;
  const ownerTeamId = movement.asset_id != null ? (asset ? asset.team_id : null) : null;
  assertCanDelete(actor, ownerTeamId);

  db.prepare("DELETE FROM asset_movements WHERE id = ?").run(id);
  logAudit(db, {
    entityType: "movement",
    entityId: id,
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
});

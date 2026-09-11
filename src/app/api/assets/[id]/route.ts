import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { logAssetChange } from "@/lib/audit";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, assertCanDelete, assertCanPlaceInRack, type Actor } from "@/lib/authz";
import { findPublicIpDuplicate } from "@/lib/ip-utils";
import { validateRackPlacement } from "@/lib/rack-validation";
import { asBody, pathId, ValidationError } from "@/lib/validation/input";
import { parseAssetBody } from "@/lib/validation/asset-input";
import { isValidIpv4 } from "@/lib/validation/asset-rules";
import type { AssetRow, RackRow } from "@/lib/db-types";

type Ctx = { params: Promise<{ id: string }> };

// 특정 자산에 대한 팀 가시성: admin/viewer는 모두 열람 가능,
// team 계정은 자기 팀 자산만. 타팀 자산은 존재 노출 방지를 위해 404로 처리.
function canSeeAsset(actor: Actor, assetTeamId: number | null): boolean {
  if (actor.role === "admin" || actor.role === "viewer") return true;
  return actor.teamId != null && assetTeamId === actor.teamId;
}

const SELECT_WITH_RACK = `
  SELECT a.*, r.rack_name, l.location_name
  FROM assets a LEFT JOIN racks r ON a.rack_id = r.id
  LEFT JOIN locations l ON r.location_id = l.id WHERE a.id = ?
`;

export const GET = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuAccess(actor, "assets");
  const id = pathId((await params).id);
  const db = getDb();

  const asset = db.prepare(SELECT_WITH_RACK).get(id) as (AssetRow & { rack_name: string | null; location_name: string | null }) | undefined;
  // 타팀 자산은 존재를 노출하지 않기 위해 404
  if (!asset || !canSeeAsset(actor, asset.team_id ?? null)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ips = db.prepare("SELECT * FROM asset_ips WHERE asset_id = ? ORDER BY is_primary DESC, id").all(id);
  const customValues = db.prepare(`
    SELECT cv.field_id, cv.value, cf.field_key, cf.field_label
    FROM custom_values cv JOIN custom_fields cf ON cv.field_id = cf.id WHERE cv.asset_id = ?
  `).all(id);

  return NextResponse.json({ ...asset, ips, custom_values: customValues });
});

export const PUT = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "assets");
  const id = pathId((await params).id);
  const db = getDb();
  const oldAsset = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;
  if (!oldAsset || !canSeeAsset(actor, oldAsset.team_id ?? null)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // 기존 행을 넘겨 건드리지 않은 레거시 날짜는 형식 검사 없이 보존
  const parsed = parseAssetBody(await readJson(req), oldAsset);
  const { columns, ips, customValues } = parsed;
  // 현재 소유 팀(team_id) 기준으로 쓰기 권한 검증
  assertCanWrite(actor, oldAsset.team_id ?? null);

  // 소유 팀 재지정: team 계정은 변경 불가(현재 값 유지), admin만 변경 가능
  let newTeamId: number | null = oldAsset.team_id ?? null;
  if (actor.role === "admin" && parsed.teamIdRaw !== undefined) {
    newTeamId = parsed.teamIdRaw === "" || parsed.teamIdRaw == null ? null : Number(parsed.teamIdRaw);
    if (newTeamId !== null && !Number.isInteger(newTeamId)) throw new ValidationError("소유 팀이 올바르지 않습니다.");
  }

  // 랙 배치 권한(팀은 자기 소유/공유 랙만) + 슬롯 중복 검증
  if (columns.rack_id) {
    const targetRack = db.prepare("SELECT team_id FROM racks WHERE id = ?").get(columns.rack_id) as Pick<RackRow, "team_id"> | undefined;
    if (!targetRack) throw new ValidationError("존재하지 않는 랙입니다.");
    assertCanPlaceInRack(actor, targetRack.team_id ?? null);
    const err = validateRackPlacement(db, columns.rack_id, columns.rack_unit_start, columns.rack_unit_size, id, columns.rack_side);
    if (err) throw new ValidationError(err);
  }

  // 공인 IP 중복 검사: 대표 IP + 다중 IP(body.ips) 대상. 자기 자신(excludeAssetId)은 제외하므로 재저장은 통과.
  // 사설 IP(10/8, 172.16/12, 192.168/16 등)는 폐쇄망 내 VIP/이중화 공유 패턴 때문에 중복을 허용한다.
  const dup = findPublicIpDuplicate(db, [columns.ip_address, ...ips.map((ip) => ip.ip_address)], id);
  if (dup) {
    return NextResponse.json(
      { error: `공인 IP ${dup.ip}은(는) 이미 '${dup.assetName}'에서 사용 중입니다.` },
      { status: 409 }
    );
  }

  // ADR-009: department는 앱이 쓰지 않으므로 기존 값을 보존한다(변조값 미반영).
  const newValues = { ...columns, department: oldAsset.department ?? "", team_id: newTeamId };

  db.transaction(() => {
    db.prepare(`
      UPDATE assets SET
        asset_type=@asset_type, asset_name=@asset_name, manufacturer=@manufacturer, model=@model,
        serial_number=@serial_number, ip_address=@ip_address, asset_tag=@asset_tag, status=@status,
        os=@os, access_ip=@access_ip, user_name=@user_name, admin_name=@admin_name, department=@department,
        network_zone=@network_zone, cia_c=@cia_c, cia_i=@cia_i, cia_a=@cia_a,
        purchase_date=@purchase_date, warranty_date=@warranty_date, eos_date=@eos_date,
        rack_id=@rack_id, rack_unit_start=@rack_unit_start, rack_unit_size=@rack_unit_size, rack_side=@rack_side,
        description=@description, team_id=@team_id, updated_at=datetime('now','localtime')
      WHERE id=@id
    `).run({ ...newValues, id });
    // 감사 newData는 실제 영속되는 스칼라 컬럼만 기록한다(custom_values 객체/ips 배열 등 비스칼라 제외).
    logAssetChange(db, {
      assetId: id,
      assetName: columns.asset_name,
      action: "update",
      changedBy: actor.username,
      oldData: oldAsset,
      newData: newValues,
    });

    // 다중 IP 교체 (본문에 ips 배열이 있을 때만 — 없으면 기존 IP 유지)
    if (parsed.ipsProvided) {
      db.prepare("DELETE FROM asset_ips WHERE asset_id = ?").run(id);
      const insertIp = db.prepare(`
        INSERT INTO asset_ips (asset_id, ip_address, ip_type, interface_name, subnet_mask, gateway, is_primary, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const ip of ips) {
        insertIp.run(id, ip.ip_address, ip.ip_type, ip.interface_name, ip.subnet_mask, ip.gateway, ip.is_primary, ip.description);
      }
      const primary = ips.find((ip) => ip.is_primary);
      if (primary) db.prepare("UPDATE assets SET ip_address = ? WHERE id = ?").run(primary.ip_address, id);
    }

    // 커스텀 필드: 빈 값은 삭제, 나머지는 upsert
    if (customValues) {
      const upsert = db.prepare(`
        INSERT INTO custom_values (asset_id, field_id, value) VALUES (?, ?, ?)
        ON CONFLICT(asset_id, field_id) DO UPDATE SET value = excluded.value
      `);
      const del = db.prepare("DELETE FROM custom_values WHERE asset_id = ? AND field_id = ?");
      for (const [fieldId, value] of Object.entries(customValues)) {
        if (!Number.isInteger(Number(fieldId))) continue;
        if (value !== undefined && String(value) !== "") upsert.run(id, Number(fieldId), String(value));
        else del.run(id, Number(fieldId));
      }
    }
  })();

  return NextResponse.json(db.prepare(SELECT_WITH_RACK).get(id));
});

// 부분 갱신(PATCH): 랙 배치(드래그앤드롭) 또는 대표 IP(IPAM 인라인 편집) 전용.
// 두 갱신 모두 나머지 필드는 건드리지 않는다. IP 분기는 랙 분기보다 먼저 —
// 랙 분기는 rack_id 부재를 "실장 해제"로 해석하므로 섞이면 IP 수정이 실장을 풀어버린다.
export const PATCH = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "assets");
  const id = pathId((await params).id);
  const body = asBody(await readJson(req));
  const db = getDb();
  const oldAsset = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;

  if (!oldAsset || !canSeeAsset(actor, oldAsset.team_id ?? null)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  assertCanWrite(actor, oldAsset.team_id ?? null);

  // ── 대표 IP 부분 갱신 (IPAM에서 진입) ──
  if ("ip_address" in body && !("rack_id" in body)) {
    const newIp = String(body.ip_address ?? "").trim();
    // IPv4 형식 검증 (빈값 = 해제 허용)
    if (newIp !== "" && !isValidIpv4(newIp)) throw new ValidationError("IPv4 형식이 아닙니다. (예: 172.16.1.10)");
    // 자산관리 경로와 동일한 공인 IP 중복 검증 — 경로별 드리프트 금지
    const dup = findPublicIpDuplicate(db, [newIp], id);
    if (dup) {
      return NextResponse.json(
        { error: `공인 IP ${dup.ip}은(는) 이미 '${dup.assetName}'에서 사용 중입니다.` },
        { status: 409 }
      );
    }
    db.prepare("UPDATE assets SET ip_address = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(newIp, id);
    logAssetChange(db, {
      assetId: id,
      assetName: oldAsset.asset_name,
      action: "update",
      changedBy: actor.username,
      oldData: { ip_address: oldAsset.ip_address },
      newData: { ip_address: newIp },
    });
    return NextResponse.json(db.prepare("SELECT * FROM assets WHERE id = ?").get(id));
  }

  const rackId = body.rack_id == null || body.rack_id === "" ? null : Number(body.rack_id);
  if (rackId !== null && (!Number.isInteger(rackId) || rackId <= 0)) throw new ValidationError("랙이 올바르지 않습니다.");
  const unitStart = rackId == null ? null : Number(body.rack_unit_start) || null;
  const unitSize = Number(body.rack_unit_size) || oldAsset.rack_unit_size || 1;
  if (!Number.isInteger(unitSize) || unitSize < 1 || unitSize > 48) throw new ValidationError("U 크기는 1~48 사이여야 합니다.");
  // 반폭 배치(rack_side): body에 키가 있으면 'L'/'R'만 인정(그 외는 null=전폭),
  // 키가 없으면 기존 값 유지(드래그앤드롭은 side를 보내지 않으므로 반폭 상태 보존). 실장 해제 시 null.
  const rackSide: "L" | "R" | null =
    rackId == null
      ? null
      : "rack_side" in body
        ? (body.rack_side === "L" || body.rack_side === "R" ? body.rack_side : null)
        : (oldAsset.rack_side === "L" || oldAsset.rack_side === "R" ? oldAsset.rack_side : null);

  // 랙 배치 권한(팀은 자기 소유/공유 랙만) — 드래그앤드롭 배치 포함
  if (rackId != null) {
    const targetRack = db.prepare("SELECT team_id FROM racks WHERE id = ?").get(rackId) as Pick<RackRow, "team_id"> | undefined;
    if (!targetRack) throw new ValidationError("존재하지 않는 랙입니다.");
    assertCanPlaceInRack(actor, targetRack.team_id ?? null);
  }

  const err = validateRackPlacement(db, rackId, unitStart, unitSize, id, rackSide);
  if (err) throw new ValidationError(err);

  db.prepare(
    "UPDATE assets SET rack_id = ?, rack_unit_start = ?, rack_unit_size = ?, rack_side = ?, updated_at = datetime('now','localtime') WHERE id = ?"
  ).run(rackId, unitStart, unitSize, rackSide, id);

  logAssetChange(db, {
    assetId: id,
    assetName: oldAsset.asset_name,
    action: "update",
    changedBy: actor.username,
    oldData: { rack_id: oldAsset.rack_id, rack_unit_start: oldAsset.rack_unit_start, rack_unit_size: oldAsset.rack_unit_size, rack_side: oldAsset.rack_side ?? null },
    newData: { rack_id: rackId, rack_unit_start: unitStart, rack_unit_size: unitSize, rack_side: rackSide },
  });

  return NextResponse.json(db.prepare(SELECT_WITH_RACK).get(id));
});

export const DELETE = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "assets");
  const id = pathId((await params).id);
  const db = getDb();
  const oldAsset = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;
  if (!oldAsset || !canSeeAsset(actor, oldAsset.team_id ?? null)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  assertCanDelete(actor, oldAsset.team_id ?? null);

  db.prepare("DELETE FROM assets WHERE id = ?").run(id);
  logAssetChange(db, {
    assetId: id,
    assetName: oldAsset.asset_name,
    action: "delete",
    changedBy: actor.username,
    oldData: oldAsset,
  });
  return NextResponse.json({ ok: true });
});

import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { logAssetChange } from "@/lib/audit";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, assertAdmin, assertCanPlaceInRack } from "@/lib/authz";
import { listAssets, parseAssetListParams } from "@/lib/asset-list";
import { findPublicIpDuplicate } from "@/lib/ip-utils";
import { validateRackPlacement } from "@/lib/rack-validation";
import { ValidationError } from "@/lib/validation/input";
import { parseAssetBody } from "@/lib/validation/asset-input";
import type { AssetRow, RackRow } from "@/lib/db-types";

// ── 목록 (서버 페이지네이션) ──
// 필터·검색·정렬·페이지는 src/lib/asset-list.ts 가 담당하고 /assets 페이지 SSR 과 동일 코드다.
// 응답은 항상 { rows, total, limit, offset, customValues? }. 기본 100건, limit=0 은 전량(내보내기용, 상한 있음).
//   ?q= 검색 · type= · rack_id= · status= · missing=ip|rack|admin|os|serial|verify · sort=created_at|asset_name|… · dir=asc|desc
//   ?cv=1 이면 페이지 행의 커스텀 필드 값 포함. ?scope=unassigned 는 총괄 전용 미배정 큐(team_id IS NULL).
export const GET = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  const wantUnassigned = req.nextUrl.searchParams.get("scope") === "unassigned";
  if (wantUnassigned) assertAdmin(actor); else assertMenuAccess(actor, "assets");
  const params = parseAssetListParams(req.nextUrl.searchParams);
  const result = listAssets(getDb(), actor, { ...params, unassignedOnly: wantUnassigned });
  return NextResponse.json(result);
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "assets");
  const parsed = parseAssetBody(await readJson(req));
  const { columns, ips, customValues } = parsed;
  // team 계정은 자기 팀으로만 생성 가능; admin은 지정/미지정 자유. viewer 불가.
  const ownerTeamId =
    actor.role === "team"
      ? actor.teamId
      : parsed.teamIdRaw === "" || parsed.teamIdRaw == null
        ? null
        : Number(parsed.teamIdRaw);
  if (ownerTeamId !== null && !Number.isInteger(ownerTeamId)) throw new ValidationError("소유 팀이 올바르지 않습니다.");
  assertCanWrite(actor, ownerTeamId);
  const db = getDb();

  // 랙 배치 권한: 팀은 자기 소유 랙 또는 공유(NULL) 랙에만. 타팀 전용 랙은 불가. + 슬롯 중복 검증.
  if (columns.rack_id) {
    const targetRack = db.prepare("SELECT team_id FROM racks WHERE id = ?").get(columns.rack_id) as Pick<RackRow, "team_id"> | undefined;
    if (!targetRack) throw new ValidationError("존재하지 않는 랙입니다.");
    assertCanPlaceInRack(actor, targetRack.team_id ?? null);
    const err = validateRackPlacement(db, columns.rack_id, columns.rack_unit_start, columns.rack_unit_size, undefined, columns.rack_side);
    if (err) throw new ValidationError(err);
  }

  // 공인 IP 중복 검사: 대표 IP + 다중 IP(body.ips) 대상.
  // 사설 IP(10/8, 172.16/12, 192.168/16 등)는 폐쇄망 내 VIP/이중화 공유 패턴 때문에 중복을 허용한다.
  const dup = findPublicIpDuplicate(db, [columns.ip_address, ...ips.map((ip) => ip.ip_address)]);
  if (dup) {
    return NextResponse.json(
      { error: `공인 IP ${dup.ip}은(는) 이미 '${dup.assetName}'에서 사용 중입니다.` },
      { status: 409 }
    );
  }

  const assetId = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO assets (asset_type, asset_name, manufacturer, model, serial_number, ip_address, asset_tag, status,
        os, access_ip, user_name, admin_name, department, network_zone, cia_c, cia_i, cia_a,
        purchase_date, warranty_date, eos_date,
        rack_id, rack_unit_start, rack_unit_size, rack_side, description, team_id)
      VALUES (@asset_type, @asset_name, @manufacturer, @model, @serial_number, @ip_address, @asset_tag, @status,
        @os, @access_ip, @user_name, @admin_name, '', @network_zone, @cia_c, @cia_i, @cia_a,
        @purchase_date, @warranty_date, @eos_date,
        @rack_id, @rack_unit_start, @rack_unit_size, @rack_side, @description, @team_id)
    `).run({ ...columns, team_id: ownerTeamId });
    const id = Number(result.lastInsertRowid);

    logAssetChange(db, {
      assetId: id,
      assetName: columns.asset_name,
      action: "create",
      changedBy: actor.username,
      newData: {
        asset_type: columns.asset_type, asset_name: columns.asset_name, manufacturer: columns.manufacturer, model: columns.model,
        ip_address: columns.ip_address, status: columns.status, rack_id: columns.rack_id, rack_unit_start: columns.rack_unit_start,
        rack_unit_size: columns.rack_unit_size, rack_side: columns.rack_side, team_id: ownerTeamId,
      },
    });

    // 다중 IP 저장
    if (ips.length) {
      const insertIp = db.prepare(`
        INSERT INTO asset_ips (asset_id, ip_address, ip_type, interface_name, subnet_mask, gateway, is_primary, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const ip of ips) {
        insertIp.run(id, ip.ip_address, ip.ip_type, ip.interface_name, ip.subnet_mask, ip.gateway, ip.is_primary, ip.description);
      }
      // primary IP를 assets.ip_address에 동기화
      const primary = ips.find((ip) => ip.is_primary);
      if (primary) db.prepare("UPDATE assets SET ip_address = ? WHERE id = ?").run(primary.ip_address, id);
    }

    // 커스텀 필드 저장
    if (customValues) {
      const upsert = db.prepare(`
        INSERT INTO custom_values (asset_id, field_id, value) VALUES (?, ?, ?)
        ON CONFLICT(asset_id, field_id) DO UPDATE SET value = excluded.value
      `);
      for (const [fieldId, value] of Object.entries(customValues)) {
        if (value !== undefined && value !== "" && Number.isInteger(Number(fieldId))) {
          upsert.run(id, Number(fieldId), String(value));
        }
      }
    }
    return id;
  })();

  const asset = db.prepare(`
    SELECT a.*, r.rack_name, l.location_name
    FROM assets a LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id WHERE a.id = ?
  `).get(assetId) as AssetRow & { rack_name: string | null; location_name: string | null };

  return NextResponse.json(asset, { status: 201 });
});


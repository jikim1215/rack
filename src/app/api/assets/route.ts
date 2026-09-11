import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { logAssetChange } from "@/lib/audit";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, assertAdmin, scopeWhere, unassignedScopeWhere, assertCanPlaceInRack } from "@/lib/authz";
import { ipSearchClause } from "@/lib/asset-search";
import { findPublicIpDuplicate } from "@/lib/ip-utils";
import { validateRackPlacement } from "@/lib/rack-validation";
import { ValidationError } from "@/lib/validation/input";
import { parseAssetBody } from "@/lib/validation/asset-input";
import type { AssetRow, RackRow } from "@/lib/db-types";

export const GET = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  const wantUnassigned = req.nextUrl.searchParams.get("scope") === "unassigned";
  // 미배정 큐(AC-11)는 총괄(admin) 전용
  if (wantUnassigned) assertAdmin(actor); else assertMenuAccess(actor, "assets");
  const scope = wantUnassigned
    ? unassignedScopeWhere(actor, "a.team_id")
    : scopeWhere(actor, "a.team_id");
  const db = getDb();
  // 다중 IP 검색(AC-5): q 파라미터로 대표 IP + asset_ips(vip/extra) + custom_values(추가IP) UNION 매칭. scope와 AND.
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const ipSearch = ipSearchClause(q, "a");
  // 서버측 페이지네이션 옵트인 (외부 검토 가격심의 갭 7 대응): limit 지정 시 {rows,total} 응답.
  // 무파라미터는 기존 전량 배열 응답 유지 — 현 규모(수백~수천)에선 전량이 단순하고,
  // 1만대급 기관은 limit 경로로 전환한다(성능 기준선: docs/ARCHITECTURE.md).
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const baseSql = `
    SELECT a.*, r.rack_name, l.location_name
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id
    WHERE ${scope.sql} AND ${ipSearch.sql}
    ORDER BY a.created_at DESC
  `;
  if (limitRaw != null) {
    const limit = Math.min(Math.max(Number(limitRaw) || 100, 1), 500);
    const offset = Math.max(Number(req.nextUrl.searchParams.get("offset")) || 0, 0);
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM assets a WHERE ${scope.sql} AND ${ipSearch.sql}`)
      .get(...scope.params, ...ipSearch.params) as { c: number }).c;
    const rows = db.prepare(`${baseSql} LIMIT ? OFFSET ?`).all(...scope.params, ...ipSearch.params, limit, offset);
    return NextResponse.json({ rows, total });
  }
  const assets = db.prepare(baseSql).all(...scope.params, ...ipSearch.params);
  return NextResponse.json(assets);
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


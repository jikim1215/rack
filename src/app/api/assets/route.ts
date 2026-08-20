import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { logAssetChange } from "@/lib/audit";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, assertCanWrite, assertAdmin, scopeWhere, unassignedScopeWhere, assertCanPlaceInRack } from "@/lib/authz";
import { ipSearchClause } from "@/lib/asset-search";
import { normalizeAccessIps } from "@/lib/access-ip";
import { findPublicIpDuplicate } from "@/lib/ip-utils";


export async function GET(req: NextRequest) {
  const actor = await getActor();
  const wantUnassigned = req.nextUrl.searchParams.get("scope") === "unassigned";
  try {
    if (wantUnassigned) {
      // 미배정 큐(AC-11)는 총괄(admin) 전용
      assertAdmin(actor);
    } else {
      assertCanRead(actor);
    }
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }
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
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  const body = await req.json();
  // team 계정은 자기 팀으로만 생성 가능; admin은 지정/미지정 자유. viewer 불가.
  const ownerTeamId =
    actor?.role === "team"
      ? actor.teamId
      : body.team_id === "" || body.team_id == null
        ? null
        : Number(body.team_id);
  try {
    assertCanWrite(actor, ownerTeamId);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }
  const db = getDb();


  // 반폭 배치(rack_side): 'L'/'R'만 인정, 그 외/미지정은 null(전폭). 랙 미설치면 null. (PUT/PATCH와 동일 규칙)
  const rackSide: "L" | "R" | null =
    body.rack_id && (body.rack_side === "L" || body.rack_side === "R") ? body.rack_side : null;

  // 랙 배치 권한: 팀은 자기 소유 랙 또는 공유(NULL) 랙에만. 타팀 전용 랙은 불가. + 슬롯 중복 검증.
  if (body.rack_id) {
    const targetRack = db.prepare("SELECT team_id FROM racks WHERE id = ?").get(Number(body.rack_id)) as any;
    if (!targetRack) return NextResponse.json({ error: "존재하지 않는 랙입니다." }, { status: 400 });
    try { assertCanPlaceInRack(actor, targetRack.team_id ?? null); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
    const { validateRackPlacement } = await import("@/lib/rack-validation");
    const err = validateRackPlacement(db, body.rack_id, body.rack_unit_start, body.rack_unit_size || 1, undefined, rackSide);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  // 공인 IP 중복 검사: 대표 IP + 다중 IP(body.ips) 대상.
  // 사설 IP(10/8, 172.16/12, 192.168/16 등)는 폐쇄망 내 VIP/이중화 공유 패턴 때문에 중복을 허용한다.
  const candidateIps: string[] = [body.ip_address || ""];
  if (body.ips && Array.isArray(body.ips)) {
    for (const ip of body.ips) candidateIps.push(ip?.ip_address || "");
  }
  const dup = findPublicIpDuplicate(db, candidateIps);
  if (dup) {
    return NextResponse.json(
      { error: `공인 IP ${dup.ip}은(는) 이미 '${dup.assetName}'에서 사용 중입니다.` },
      { status: 409 }
    );
  }

  const result = db.prepare(`
    INSERT INTO assets (asset_type, asset_name, manufacturer, model, serial_number, ip_address, asset_tag, status,
      os, access_ip, user_name, admin_name, department, network_zone, cia_c, cia_i, cia_a,
      purchase_date, warranty_date, eos_date,
      rack_id, rack_unit_start, rack_unit_size, rack_side, description, team_id)
    VALUES (@asset_type, @asset_name, @manufacturer, @model, @serial_number, @ip_address, @asset_tag, @status,
      @os, @access_ip, @user_name, @admin_name, @department, @network_zone, @cia_c, @cia_i, @cia_a,
      @purchase_date, @warranty_date, @eos_date,
      @rack_id, @rack_unit_start, @rack_unit_size, @rack_side, @description, @team_id)
  `).run({
    asset_type: body.asset_type,
    asset_name: body.asset_name || body.name,
    manufacturer: body.manufacturer || "",
    model: body.model || "",
    serial_number: body.serial_number || "",
    ip_address: body.ip_address || "",
    asset_tag: body.asset_tag || "",
    status: body.status || "active",
    os: body.os || "",
    access_ip: normalizeAccessIps(body.access_ip),
    user_name: body.user_name || "",
    admin_name: body.admin_name || "",
    department: "",
    network_zone: body.network_zone || "",
    cia_c: body.cia_c === "" || body.cia_c == null ? null : Number(body.cia_c),
    cia_i: body.cia_i === "" || body.cia_i == null ? null : Number(body.cia_i),
    cia_a: body.cia_a === "" || body.cia_a == null ? null : Number(body.cia_a),
    purchase_date: body.purchase_date || "",
    warranty_date: body.warranty_date || "",
    eos_date: body.eos_date || "",
    rack_id: body.rack_id || null,
    rack_unit_start: body.rack_unit_start || null,
    rack_unit_size: body.rack_unit_size || 1,
    rack_side: rackSide,
    description: body.description || "",
    team_id: ownerTeamId,
  });

  const assetId = result.lastInsertRowid;
  logAssetChange(db, {
    assetId: Number(assetId),
    assetName: body.asset_name || body.name || '',
    action: 'create',
    changedBy: actor?.username || 'system',
    newData: { asset_type: body.asset_type, asset_name: body.asset_name, manufacturer: body.manufacturer, model: body.model, ip_address: body.ip_address, status: body.status, rack_id: body.rack_id || null, rack_unit_start: body.rack_unit_start || null, rack_unit_size: body.rack_unit_size || 1, rack_side: rackSide },
  });

  // 다중 IP 저장
  if (body.ips && Array.isArray(body.ips)) {
    const insertIp = db.prepare(`
      INSERT INTO asset_ips (asset_id, ip_address, ip_type, interface_name, subnet_mask, gateway, is_primary, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const ip of body.ips) {
      if (ip.ip_address) {
        insertIp.run(assetId, ip.ip_address, ip.ip_type || "service", ip.interface_name || "",
          ip.subnet_mask || "", ip.gateway || "", ip.is_primary ? 1 : 0, ip.description || "");
      }
    }
    // primary IP를 assets.ip_address에 동기화
    const primary = body.ips.find((ip: any) => ip.is_primary);
    if (primary) {
      db.prepare("UPDATE assets SET ip_address = ? WHERE id = ?").run(primary.ip_address, assetId);
    }
  }

  // 커스텀 필드 저장
  if (body.custom_values && typeof body.custom_values === "object") {
    const upsert = db.prepare(`
      INSERT INTO custom_values (asset_id, field_id, value) VALUES (?, ?, ?)
      ON CONFLICT(asset_id, field_id) DO UPDATE SET value = excluded.value
    `);
    for (const [fieldId, value] of Object.entries(body.custom_values)) {
      if (value !== undefined && value !== "") {
        upsert.run(assetId, Number(fieldId), String(value));
      }
    }
  }

  const asset = db.prepare(`
    SELECT a.*, r.rack_name, l.location_name
    FROM assets a LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id WHERE a.id = ?
  `).get(assetId);

  return NextResponse.json(asset, { status: 201 });
}

import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { logAssetChange } from "@/lib/audit";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, assertCanWrite, assertCanDelete, assertCanPlaceInRack } from "@/lib/authz";
import { normalizeAccessIps } from "@/lib/access-ip";
import { findPublicIpDuplicate } from "@/lib/ip-utils";

// 특정 자산에 대한 팀 가시성: admin/viewer는 모두 열람 가능,
// team 계정은 자기 팀 자산만. 타팀 자산은 존재 노출 방지를 위해 404로 처리.
function canSeeAsset(actor: Awaited<ReturnType<typeof getActor>>, assetTeamId: number | null): boolean {
  if (!actor) return false;
  if (actor.role === "admin" || actor.role === "viewer") return true;
  // team
  return actor.teamId != null && assetTeamId === actor.teamId;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  try {
    assertCanRead(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }
  const { id } = await params;
  const db = getDb();

  const asset = db.prepare(`
    SELECT a.*, r.rack_name, l.location_name
    FROM assets a LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id WHERE a.id = ?
  `).get(Number(id)) as any;

  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // 타팀 자산은 존재를 노출하지 않기 위해 404
  if (!canSeeAsset(actor, asset.team_id ?? null)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ips = db.prepare("SELECT * FROM asset_ips WHERE asset_id = ? ORDER BY is_primary DESC, id").all(Number(id));
  const customValues = db.prepare(`
    SELECT cv.field_id, cv.value, cf.field_key, cf.field_label
    FROM custom_values cv JOIN custom_fields cf ON cv.field_id = cf.id WHERE cv.asset_id = ?
  `).all(Number(id));

  return NextResponse.json({ ...asset as any, ips, custom_values: customValues });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  const oldAsset = db.prepare('SELECT * FROM assets WHERE id = ?').get(Number(id)) as any;

  if (!oldAsset) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // 현재 소유 팀(team_id) 기준으로 쓰기 권한 검증
  try {
    assertCanWrite(actor, oldAsset.team_id ?? null);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  // 소유 팀 재지정: team 계정은 변경 불가(현재 값 유지), admin만 변경 가능
  const newTeamId =
    actor?.role === "admin"
      ? (body.team_id === "" || body.team_id == null ? (oldAsset.team_id ?? null) : Number(body.team_id))
      : (oldAsset.team_id ?? null);

  // 반폭 배치(rack_side): 'L'/'R'만 인정, 그 외/미지정은 null(전폭). 랙 미설치면 null.
  const rackSide: "L" | "R" | null =
    body.rack_id && (body.rack_side === "L" || body.rack_side === "R") ? body.rack_side : null;

  // 랙 배치 권한(팀은 자기 소유/공유 랙만) + 슬롯 중복 검증
  if (body.rack_id) {
    const targetRack = db.prepare("SELECT team_id FROM racks WHERE id = ?").get(Number(body.rack_id)) as any;
    if (!targetRack) return NextResponse.json({ error: "존재하지 않는 랙입니다." }, { status: 400 });
    try { assertCanPlaceInRack(actor, targetRack.team_id ?? null); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
    const { validateRackPlacement } = await import("@/lib/rack-validation");
    const err = validateRackPlacement(db, body.rack_id, body.rack_unit_start, body.rack_unit_size || 1, Number(id), rackSide);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  // 공인 IP 중복 검사: 대표 IP + 다중 IP(body.ips) 대상. 자기 자신(excludeAssetId)은 제외하므로 재저장은 통과.
  // 사설 IP(10/8, 172.16/12, 192.168/16 등)는 폐쇄망 내 VIP/이중화 공유 패턴 때문에 중복을 허용한다.
  const candidateIps: string[] = [body.ip_address || ""];
  if (body.ips && Array.isArray(body.ips)) {
    for (const ip of body.ips) candidateIps.push(ip?.ip_address || "");
  }
  const dup = findPublicIpDuplicate(db, candidateIps, Number(id));
  if (dup) {
    return NextResponse.json(
      { error: `공인 IP ${dup.ip}은(는) 이미 '${dup.assetName}'에서 사용 중입니다.` },
      { status: 409 }
    );
  }

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
  `).run({
    id: Number(id), asset_type: body.asset_type, asset_name: body.asset_name || body.name,
    manufacturer: body.manufacturer || "", model: body.model || "",
    serial_number: body.serial_number || "", ip_address: body.ip_address || "",
    asset_tag: body.asset_tag || "", status: body.status || "active",
    os: body.os || "", access_ip: normalizeAccessIps(body.access_ip),
    user_name: body.user_name || "", admin_name: body.admin_name || "",
    department: oldAsset.department ?? "",
    network_zone: body.network_zone || "",
    cia_c: body.cia_c === "" || body.cia_c == null ? null : Number(body.cia_c),
    cia_i: body.cia_i === "" || body.cia_i == null ? null : Number(body.cia_i),
    cia_a: body.cia_a === "" || body.cia_a == null ? null : Number(body.cia_a),
    purchase_date: body.purchase_date || "", warranty_date: body.warranty_date || "",
    eos_date: body.eos_date || "",
    rack_id: body.rack_id || null, rack_unit_start: body.rack_unit_start || null,
    rack_unit_size: body.rack_unit_size || 1, rack_side: rackSide, description: body.description || "",
    team_id: newTeamId,
  });
  logAssetChange(db, {
    assetId: Number(id),
    assetName: body.asset_name || oldAsset?.asset_name || '',
    action: 'update',
    changedBy: actor?.username || 'system',
    oldData: oldAsset || {},
    // ADR-009: department는 앱이 쓰지 않으므로 감사 newData도 실제 보존값으로 기록(변조값 미반영). team_id는 실제 적용값.
    // 감사 newData는 실제 영속되는 스칼라 컬럼만 기록한다(custom_values 객체/ips 배열 등 비스칼라 제외 → '[object Object]' 노이즈/변조값 미반영 방지).
    newData: {
      asset_type: body.asset_type, asset_name: body.asset_name, manufacturer: body.manufacturer || "",
      model: body.model || "", serial_number: body.serial_number || "", ip_address: body.ip_address || "",
      asset_tag: body.asset_tag || "", status: body.status, os: body.os || "", access_ip: normalizeAccessIps(body.access_ip),
      user_name: body.user_name || "", admin_name: body.admin_name || "", department: oldAsset.department ?? "",
      network_zone: body.network_zone || "",
      cia_c: body.cia_c === "" || body.cia_c == null ? null : Number(body.cia_c),
      cia_i: body.cia_i === "" || body.cia_i == null ? null : Number(body.cia_i),
      cia_a: body.cia_a === "" || body.cia_a == null ? null : Number(body.cia_a),
      purchase_date: body.purchase_date || "", warranty_date: body.warranty_date || "", eos_date: body.eos_date || "",
      rack_id: body.rack_id || null, rack_unit_start: body.rack_unit_start || null,
      rack_unit_size: body.rack_unit_size || 1, rack_side: rackSide, description: body.description || "", team_id: newTeamId,
    },
  });


  // 다중 IP 교체
  if (body.ips && Array.isArray(body.ips)) {
    db.prepare("DELETE FROM asset_ips WHERE asset_id = ?").run(Number(id));
    const insertIp = db.prepare(`
      INSERT INTO asset_ips (asset_id, ip_address, ip_type, interface_name, subnet_mask, gateway, is_primary, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const ip of body.ips) {
      if (ip.ip_address) {
        insertIp.run(Number(id), ip.ip_address, ip.ip_type || "service", ip.interface_name || "",
          ip.subnet_mask || "", ip.gateway || "", ip.is_primary ? 1 : 0, ip.description || "");
      }
    }
    const primary = body.ips.find((ip: any) => ip.is_primary);
    if (primary) {
      db.prepare("UPDATE assets SET ip_address = ? WHERE id = ?").run(primary.ip_address, Number(id));
    }
  }

  // 커스텀 필드
  if (body.custom_values && typeof body.custom_values === "object") {
    const upsert = db.prepare(`
      INSERT INTO custom_values (asset_id, field_id, value) VALUES (?, ?, ?)
      ON CONFLICT(asset_id, field_id) DO UPDATE SET value = excluded.value
    `);
    const del = db.prepare("DELETE FROM custom_values WHERE asset_id = ? AND field_id = ?");
    for (const [fieldId, value] of Object.entries(body.custom_values)) {
      if (value !== undefined && String(value) !== "") {
        upsert.run(Number(id), Number(fieldId), String(value));
      } else {
        del.run(Number(id), Number(fieldId));
      }
    }
  }

  const asset = db.prepare(`
    SELECT a.*, r.rack_name, l.location_name
    FROM assets a LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id WHERE a.id = ?
  `).get(Number(id));

  return NextResponse.json(asset);
}

// 부분 갱신(PATCH): 랙 배치(드래그앤드롭) 또는 대표 IP(IPAM 인라인 편집) 전용.
// 두 갱신 모두 나머지 필드는 건드리지 않는다. IP 분기는 랙 분기보다 먼저 —
// 랙 분기는 rack_id 부재를 "실장 해제"로 해석하므로 섞이면 IP 수정이 실장을 풀어버린다.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  const oldAsset = db.prepare("SELECT * FROM assets WHERE id = ?").get(Number(id)) as any;

  if (!oldAsset || !canSeeAsset(actor, oldAsset.team_id ?? null)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    assertCanWrite(actor, oldAsset.team_id ?? null);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  // ── 대표 IP 부분 갱신 (IPAM에서 진입) ──
  if ("ip_address" in body && !("rack_id" in body)) {
    const newIp = String(body.ip_address ?? "").trim();
    // IPv4 형식 검증 (빈값 = 해제 허용)
    if (newIp !== "" && !/^(\d{1,3})(\.\d{1,3}){3}$/.test(newIp)) {
      return NextResponse.json({ error: "IPv4 형식이 아닙니다. (예: 172.16.1.10)" }, { status: 400 });
    }
    // 자산관리 경로와 동일한 공인 IP 중복 검증 — 경로별 드리프트 금지
    const dup = findPublicIpDuplicate(db, [newIp], Number(id));
    if (dup) {
      return NextResponse.json(
        { error: `공인 IP ${dup.ip}은(는) 이미 '${dup.assetName}'에서 사용 중입니다.` },
        { status: 409 }
      );
    }
    db.prepare("UPDATE assets SET ip_address = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(newIp, Number(id));
    logAssetChange(db, {
      assetId: Number(id),
      assetName: oldAsset.asset_name,
      action: "update",
      changedBy: actor?.username || "system",
      oldData: { ip_address: oldAsset.ip_address },
      newData: { ip_address: newIp },
    });
    const updated = db.prepare("SELECT * FROM assets WHERE id = ?").get(Number(id));
    return NextResponse.json(updated);
  }

  const rackId = body.rack_id == null || body.rack_id === "" ? null : Number(body.rack_id);
  const unitStart = rackId == null ? null : Number(body.rack_unit_start) || null;
  const unitSize = Number(body.rack_unit_size) || oldAsset.rack_unit_size || 1;
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
    const targetRack = db.prepare("SELECT team_id FROM racks WHERE id = ?").get(rackId) as any;
    if (!targetRack) return NextResponse.json({ error: "존재하지 않는 랙입니다." }, { status: 400 });
    try { assertCanPlaceInRack(actor, targetRack.team_id ?? null); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  }

  const { validateRackPlacement } = await import("@/lib/rack-validation");
  const err = validateRackPlacement(db, rackId, unitStart, unitSize, Number(id), rackSide);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  db.prepare(
    "UPDATE assets SET rack_id = ?, rack_unit_start = ?, rack_unit_size = ?, rack_side = ?, updated_at = datetime('now','localtime') WHERE id = ?"
  ).run(rackId, unitStart, unitSize, rackSide, Number(id));

  logAssetChange(db, {
    assetId: Number(id),
    assetName: oldAsset.asset_name,
    action: "update",
    changedBy: actor?.username || "system",
    oldData: { rack_id: oldAsset.rack_id, rack_unit_start: oldAsset.rack_unit_start, rack_unit_size: oldAsset.rack_unit_size, rack_side: oldAsset.rack_side ?? null },
    newData: { rack_id: rackId, rack_unit_start: unitStart, rack_unit_size: unitSize, rack_side: rackSide },
  });

  const asset = db.prepare(`
    SELECT a.*, r.rack_name, l.location_name
    FROM assets a LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id WHERE a.id = ?
  `).get(Number(id));

  return NextResponse.json(asset);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const db = getDb();
  const oldAsset = db.prepare('SELECT * FROM assets WHERE id = ?').get(Number(id)) as any;

  if (!oldAsset) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    assertCanDelete(actor, oldAsset.team_id ?? null);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  db.prepare("DELETE FROM assets WHERE id = ?").run(Number(id));
  logAssetChange(db, {
    assetId: Number(id),
    assetName: oldAsset?.asset_name || '',
    action: 'delete',
    changedBy: actor?.username || 'system',
    oldData: oldAsset || {},
  });
  return NextResponse.json({ ok: true });
}

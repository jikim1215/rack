import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, assertCanDelete, scopeWhere } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { asBody, str, idOrNull, pathId, ValidationError } from "@/lib/validation/input";
import { isValidIpv4 } from "@/lib/validation/asset-rules";
import { splitAccessIps } from "@/lib/access-ip";
import type { SubnetRow } from "@/lib/db-types";

type Ctx = { params: Promise<{ id: string }> };

function ipToNum(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function maskToCidr(mask: string): number {
  const n = ipToNum(mask);
  let bits = 0;
  let v = n;
  while (v & 0x80000000) { bits++; v <<= 1; }
  return bits;
}

export const GET = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuAccess(actor, "ipam");
  const id = pathId((await params).id);
  const db = getDb();

  const subnet = db.prepare(
    `SELECT s.*, l.location_name, t.team_name AS owner_team_name FROM ip_subnets s
     LEFT JOIN locations l ON s.location_id = l.id
     LEFT JOIN teams t ON s.team_id = t.id
     WHERE s.id = ?`
  ).get(id) as (SubnetRow & { location_name: string | null; owner_team_name: string | null }) | undefined;

  if (!subnet) {
    return NextResponse.json({ error: "서브넷을 찾을 수 없습니다" }, { status: 404 });
  }

  // 소유 전용: 팀은 자기 팀 대역만 조회. 타팀/공유(NULL) 대역은 404로 가린다(존재 노출 방지).
  if (actor.role === "team" && subnet.team_id !== actor.teamId) {
    return NextResponse.json({ error: "서브넷을 찾을 수 없습니다" }, { status: 404 });
  }

  // 해당 대역 IP 사용 현황 — asset_ips 는 자산 귀속 → 팀 사용자는 자기 팀 자산 IP만 (타팀 asset_name 누출 방지)
  const scope = scopeWhere(actor, "a.team_id");
  const allIps = db.prepare(
    `SELECT ai.*, a.asset_name FROM asset_ips ai
     LEFT JOIN assets a ON ai.asset_id = a.id
     WHERE ${scope.sql}`
  ).all(...scope.params) as { ip_address: string; asset_name: string | null }[];

  // 서브넷 범위 필터링
  const netNum = ipToNum(subnet.network_address);
  const cidr = maskToCidr(subnet.subnet_mask);
  const mask = (0xFFFFFFFF << (32 - cidr)) >>> 0;
  const netStart = netNum & mask;
  const netEnd = netStart | (~mask >>> 0);

  const assignedIps = allIps.filter((ip) => {
    const ipNum = ipToNum(ip.ip_address);
    return ipNum >= netStart && ipNum <= netEnd;
  });

  return NextResponse.json({ ...subnet, assigned_ips: assignedIps });
});

export const PUT = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "ipam");
  const id = pathId((await params).id);
  const b = asBody(await readJson(req));
  const db = getDb();
  const existing = db.prepare("SELECT * FROM ip_subnets WHERE id = ?").get(id) as SubnetRow | undefined;
  if (!existing) return NextResponse.json({ error: "서브넷을 찾을 수 없습니다" }, { status: 404 });
  assertCanWrite(actor, existing.team_id ?? null);

  const subnet_name = str(b, "subnet_name", { required: true, label: "서브넷 이름" });
  const network_address = str(b, "network_address", { required: true, label: "네트워크 주소" });
  if (!isValidIpv4(network_address)) throw new ValidationError("네트워크 주소는 IPv4 형식이어야 합니다.");
  const subnet_mask = str(b, "subnet_mask", { default: "255.255.255.0" });
  const gateway = str(b, "gateway");
  if (gateway && !isValidIpv4(gateway)) throw new ValidationError("게이트웨이는 IPv4 형식이어야 합니다.");
  const vlan_id = str(b, "vlan_id", { max: 20 });
  const location_id = idOrNull(b, "location_id", "위치");
  const description = str(b, "description");

  let ownerTeamId: number | null = existing.team_id ?? null;
  if (actor.role === "admin" && "team_id" in b) {
    ownerTeamId = b.team_id === "" || b.team_id == null ? null : Number(b.team_id);
    if (ownerTeamId !== null && !Number.isInteger(ownerTeamId)) throw new ValidationError("소유 팀이 올바르지 않습니다.");
    if (ownerTeamId != null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId)) {
      throw new ValidationError("존재하지 않는 팀입니다.");
    }
  }

  db.prepare(
    `UPDATE ip_subnets SET subnet_name = @subnet_name, network_address = @network_address,
     subnet_mask = @subnet_mask, gateway = @gateway, vlan_id = @vlan_id,
     location_id = @location_id, description = @description, team_id = @team_id WHERE id = @id`
  ).run({ id, subnet_name, network_address, subnet_mask, gateway, vlan_id, location_id, description, team_id: ownerTeamId });

  const updated = db.prepare("SELECT * FROM ip_subnets WHERE id = ?").get(id) as SubnetRow;
  return NextResponse.json(updated);
});

export const DELETE = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "ipam");
  const id = pathId((await params).id);
  const db = getDb();

  const subnet = db.prepare("SELECT * FROM ip_subnets WHERE id = ?").get(id) as SubnetRow | undefined;
  if (!subnet) return NextResponse.json({ error: "서브넷을 찾을 수 없습니다" }, { status: 404 });
  assertCanDelete(actor, subnet.team_id ?? null);

  // 사용중 IP가 있는 대역은 삭제 차단 — 실수로 조회 창을 잃는 것을 방지 (개수만 집계, 자산명 비노출).
  // 대역 정보가 잘못 등록된 경우는 삭제가 아니라 수정(PUT)으로 고친다.
  const netNum = ipToNum(subnet.network_address);
  const cidr = maskToCidr(subnet.subnet_mask);
  const mask = (0xFFFFFFFF << (32 - cidr)) >>> 0;
  const netStart = (netNum & mask) >>> 0;
  const netEnd = netStart + (~mask >>> 0);
  const inRange = (ip: string) => {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test((ip || "").trim())) return false;
    const n = ipToNum(ip.trim());
    return n >= netStart && n <= netEnd;
  };

  let used = 0;
  for (const r of db.prepare("SELECT ip_address FROM assets WHERE ip_address <> '' AND status <> 'retired'").all() as { ip_address: string }[]) {
    if (inRange(r.ip_address)) used++;
  }
  for (const r of db.prepare("SELECT ai.ip_address FROM asset_ips ai JOIN assets a ON a.id = ai.asset_id AND a.status <> 'retired'").all() as { ip_address: string }[]) {
    if (inRange(r.ip_address)) used++;
  }
  for (const r of db.prepare("SELECT access_ip FROM assets WHERE access_ip <> '' AND status <> 'retired'").all() as { access_ip: string }[]) {
    for (const ip of splitAccessIps(r.access_ip)) if (inRange(ip)) used++;
  }

  if (used > 0) {
    return NextResponse.json(
      { error: `이 대역에 사용중 IP가 ${used}개 있어 삭제할 수 없습니다. 먼저 해당 IP를 해제·변경하거나, 대역 정보가 잘못 등록된 것이라면 삭제 대신 '수정'으로 고치세요.` },
      { status: 409 }
    );
  }

  db.prepare("DELETE FROM ip_subnets WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
});

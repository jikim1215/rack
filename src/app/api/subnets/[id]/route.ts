import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const subnet = db.prepare(
    `SELECT s.*, l.location_name FROM ip_subnets s
     LEFT JOIN locations l ON s.location_id = l.id
     WHERE s.id = ?`
  ).get(Number(id)) as any;

  if (!subnet) {
    return NextResponse.json({ error: "서브넷을 찾을 수 없습니다" }, { status: 404 });
  }

  // 해당 대역 IP 사용 현황
  const allIps = db.prepare(
    `SELECT ai.*, a.asset_name FROM asset_ips ai
     LEFT JOIN assets a ON ai.asset_id = a.id`
  ).all() as any[];

  // 서브넷 범위 필터링
  const netNum = ipToNum(subnet.network_address);
  const cidr = maskToCidr(subnet.subnet_mask);
  const mask = (0xFFFFFFFF << (32 - cidr)) >>> 0;
  const netStart = netNum & mask;
  const netEnd = netStart | (~mask >>> 0);

  const assignedIps = allIps.filter((ip: any) => {
    const ipNum = ipToNum(ip.ip_address);
    return ipNum >= netStart && ipNum <= netEnd;
  });

  return NextResponse.json({ ...subnet, assigned_ips: assignedIps });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  db.prepare(
    `UPDATE ip_subnets SET subnet_name = @subnet_name, network_address = @network_address,
     subnet_mask = @subnet_mask, gateway = @gateway, vlan_id = @vlan_id,
     location_id = @location_id, description = @description WHERE id = @id`
  ).run({
    id: Number(id),
    subnet_name: body.subnet_name || "",
    network_address: body.network_address || "",
    subnet_mask: body.subnet_mask || "255.255.255.0",
    gateway: body.gateway || "",
    vlan_id: body.vlan_id || "",
    location_id: body.location_id ? Number(body.location_id) : null,
    description: body.description || "",
  });

  const updated = db.prepare("SELECT * FROM ip_subnets WHERE id = ?").get(Number(id));
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM ip_subnets WHERE id = ?").run(Number(id));
  return NextResponse.json({ ok: true });
}

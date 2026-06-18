import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  const subnets = db.prepare(
    `SELECT s.*, l.location_name FROM ip_subnets s
     LEFT JOIN locations l ON s.location_id = l.id
     ORDER BY s.network_address`
  ).all();
  return NextResponse.json(subnets);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { subnet_name, network_address, subnet_mask, gateway, vlan_id, location_id, description } = body;

  if (!subnet_name || !network_address) {
    return NextResponse.json({ error: "subnet_name, network_address 필수" }, { status: 400 });
  }

  // x.x.x.x 형식 검증
  const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipPattern.test(network_address)) {
    return NextResponse.json({ error: "네트워크 주소 형식이 올바르지 않습니다 (x.x.x.x)" }, { status: 400 });
  }
  const octets = network_address.split(".").map(Number);
  if (octets.some((o: number) => o < 0 || o > 255)) {
    return NextResponse.json({ error: "각 옥텟은 0~255 범위여야 합니다" }, { status: 400 });
  }

  const db = getDb();
  const result = db.prepare(
    `INSERT INTO ip_subnets (subnet_name, network_address, subnet_mask, gateway, vlan_id, location_id, description)
     VALUES (@subnet_name, @network_address, @subnet_mask, @gateway, @vlan_id, @location_id, @description)`
  ).run({
    subnet_name,
    network_address,
    subnet_mask: subnet_mask || "255.255.255.0",
    gateway: gateway || "",
    vlan_id: vlan_id || "",
    location_id: location_id ? Number(location_id) : null,
    description: description || "",
  });

  const created = db.prepare("SELECT * FROM ip_subnets WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(created, { status: 201 });
}

import { getDb } from "@/lib/db";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, assertCanWrite, scopeWhere } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const actor = await getActor();
  try { assertCanRead(actor); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const db = getDb();
  // 소유 전용(team_id): 팀은 자기 팀 대역만. 총괄/전체열람은 전체.
  const scope = scopeWhere(actor, "s.team_id");
  const subnets = db.prepare(
    `SELECT s.*, l.location_name, t.team_name AS owner_team_name FROM ip_subnets s
     LEFT JOIN locations l ON s.location_id = l.id
     LEFT JOIN teams t ON s.team_id = t.id
     WHERE ${scope.sql}
     ORDER BY s.network_address`
  ).all(...scope.params);
  return NextResponse.json(subnets);
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  const body = await req.json();
  const ownerTeamId =
    actor?.role === "team"
      ? actor.teamId
      : body.team_id === "" || body.team_id == null
        ? null
        : Number(body.team_id);
  try { assertCanWrite(actor, ownerTeamId); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
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
  if (ownerTeamId != null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId)) {
    return NextResponse.json({ error: "존재하지 않는 팀입니다." }, { status: 400 });
  }
  const result = db.prepare(
    `INSERT INTO ip_subnets (subnet_name, network_address, subnet_mask, gateway, vlan_id, location_id, description, team_id)
     VALUES (@subnet_name, @network_address, @subnet_mask, @gateway, @vlan_id, @location_id, @description, @team_id)`
  ).run({
    subnet_name,
    network_address,
    subnet_mask: subnet_mask || "255.255.255.0",
    gateway: gateway || "",
    vlan_id: vlan_id || "",
    location_id: location_id ? Number(location_id) : null,
    description: description || "",
    team_id: ownerTeamId,
  });

  const created = db.prepare("SELECT * FROM ip_subnets WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(created, { status: 201 });
}

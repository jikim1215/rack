import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, scopeWhere } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { asBody, str, idOrNull, ValidationError } from "@/lib/validation/input";
import { isValidIpv4 } from "@/lib/validation/asset-rules";
import type { SubnetRow } from "@/lib/db-types";

export const GET = withApi(async (_req: NextRequest) => {
  const actor = await getActor();
  assertMenuAccess(actor, "ipam");
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
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "ipam");
  const b = asBody(await readJson(req));
  const ownerTeamId =
    actor.role === "team"
      ? actor.teamId
      : b.team_id === "" || b.team_id == null
        ? null
        : Number(b.team_id);
  if (ownerTeamId !== null && !Number.isInteger(ownerTeamId)) throw new ValidationError("소유 팀이 올바르지 않습니다.");
  assertCanWrite(actor, ownerTeamId);

  const subnet_name = str(b, "subnet_name", { required: true, label: "서브넷 이름" });
  const network_address = str(b, "network_address", { required: true, label: "네트워크 주소" });
  if (!isValidIpv4(network_address)) throw new ValidationError("네트워크 주소는 IPv4 형식이어야 합니다.");
  const subnet_mask = str(b, "subnet_mask", { default: "255.255.255.0" });
  const gateway = str(b, "gateway");
  if (gateway && !isValidIpv4(gateway)) throw new ValidationError("게이트웨이는 IPv4 형식이어야 합니다.");
  const vlan_id = str(b, "vlan_id", { max: 20 });
  const location_id = idOrNull(b, "location_id", "위치");
  const description = str(b, "description");

  const db = getDb();
  if (ownerTeamId != null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId)) {
    throw new ValidationError("존재하지 않는 팀입니다.");
  }
  const result = db.prepare(
    `INSERT INTO ip_subnets (subnet_name, network_address, subnet_mask, gateway, vlan_id, location_id, description, team_id)
     VALUES (@subnet_name, @network_address, @subnet_mask, @gateway, @vlan_id, @location_id, @description, @team_id)`
  ).run({ subnet_name, network_address, subnet_mask, gateway, vlan_id, location_id, description, team_id: ownerTeamId });

  const created = db.prepare("SELECT * FROM ip_subnets WHERE id = ?").get(result.lastInsertRowid) as SubnetRow;
  return NextResponse.json(created, { status: 201 });
});

import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, scopeWhere } from "@/lib/authz";
import { asBody, str, oneOf, dateStr, flag, idOrNull, ValidationError } from "@/lib/validation/input";
import { NextRequest, NextResponse } from "next/server";
import type { ContractRow } from "@/lib/db-types";

export const GET = withApi(async (_req: NextRequest) => {
  const actor = await getActor();
  assertMenuAccess(actor, "contracts");
  const db = getDb();
  // 소유 전용(team_id): 팀은 자기 팀 계약만. 총괄/전체열람은 전체.
  const scope = scopeWhere(actor, "c.team_id");
  const contracts = db.prepare(`
    SELECT c.*, v.vendor_name, t.team_name AS owner_team_name
    FROM contracts c
    LEFT JOIN vendors v ON c.vendor_id = v.id
    LEFT JOIN teams t ON c.team_id = t.id
    WHERE ${scope.sql}
    ORDER BY c.end_date
  `).all(...scope.params) as (ContractRow & { vendor_name: string | null; owner_team_name: string | null })[];
  return NextResponse.json(contracts);
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "contracts");
  const b = asBody(await readJson(req));
  const ownerTeamId =
    actor.role === "team"
      ? actor.teamId
      : idOrNull(b, "team_id", "소유 팀");
  assertCanWrite(actor, ownerTeamId);
  const db = getDb();
  if (ownerTeamId != null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId)) {
    throw new ValidationError("존재하지 않는 팀입니다.");
  }
  const vendorId = idOrNull(b, "vendor_id", "업체");
  if (vendorId != null && !db.prepare("SELECT id FROM vendors WHERE id = ?").get(vendorId)) {
    throw new ValidationError("존재하지 않는 업체입니다.");
  }
  const values = {
    vendor_id: vendorId,
    contract_name: str(b, "contract_name", { required: true, max: 200, label: "계약명" }),
    contract_type: oneOf(b, "contract_type", ["maintenance", "purchase", "lease", "other"] as const, { default: "maintenance", label: "계약 유형" }),
    start_date: dateStr(b, "start_date", { label: "시작일" }),
    end_date: dateStr(b, "end_date", { label: "종료일" }),
    amount: str(b, "amount", { max: 50, label: "금액" }),
    auto_renew: flag(b, "auto_renew"),
    notes: str(b, "notes", { max: 2000, label: "비고" }),
    team_id: ownerTeamId,
  };
  const result = db.prepare(`
    INSERT INTO contracts (vendor_id, contract_name, contract_type, start_date, end_date, amount, auto_renew, notes, team_id)
    VALUES (@vendor_id, @contract_name, @contract_type, @start_date, @end_date, @amount, @auto_renew, @notes, @team_id)
  `).run(values);
  const contract = db.prepare(`
    SELECT c.*, v.vendor_name, t.team_name AS owner_team_name FROM contracts c
    LEFT JOIN vendors v ON c.vendor_id = v.id LEFT JOIN teams t ON c.team_id = t.id WHERE c.id = ?
  `).get(result.lastInsertRowid) as ContractRow & { vendor_name: string | null; owner_team_name: string | null };
  return NextResponse.json(contract, { status: 201 });
});

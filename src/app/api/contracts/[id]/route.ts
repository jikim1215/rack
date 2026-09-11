import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuWrite, assertCanWrite, assertCanDelete } from "@/lib/authz";
import { asBody, str, oneOf, flag, idOrNull, pathId, ValidationError, dateStrKeep } from "@/lib/validation/input";
import { NextRequest, NextResponse } from "next/server";
import type { ContractRow } from "@/lib/db-types";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "contracts");
  const id = pathId((await params).id);
  const b = asBody(await readJson(req));
  const db = getDb();
  const existing = db.prepare("SELECT * FROM contracts WHERE id = ?").get(id) as ContractRow | undefined;
  if (!existing) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
  assertCanWrite(actor, existing.team_id ?? null);

  let ownerTeamId: number | null = existing.team_id ?? null;
  if (actor.role === "admin" && "team_id" in b) {
    ownerTeamId = idOrNull(b, "team_id", "소유 팀");
    if (ownerTeamId != null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId)) {
      throw new ValidationError("존재하지 않는 팀입니다.");
    }
  }
  const vendorId = idOrNull(b, "vendor_id", "업체");
  if (vendorId != null && !db.prepare("SELECT id FROM vendors WHERE id = ?").get(vendorId)) {
    throw new ValidationError("존재하지 않는 업체입니다.");
  }
  db.prepare(`
    UPDATE contracts SET vendor_id = @vendor_id, contract_name = @contract_name,
      contract_type = @contract_type, start_date = @start_date, end_date = @end_date,
      amount = @amount, auto_renew = @auto_renew, status = @status, notes = @notes, team_id = @team_id
    WHERE id = @id
  `).run({
    id,
    vendor_id: vendorId,
    contract_name: str(b, "contract_name", { required: true, max: 200, label: "계약명" }),
    contract_type: oneOf(b, "contract_type", ["maintenance", "purchase", "lease", "other"] as const, { default: "maintenance", label: "계약 유형" }),
    // 건드리지 않은 레거시 날짜는 통과 (자산 PUT 과 동일 규칙)
    start_date: dateStrKeep(b, "start_date", existing.start_date, { label: "시작일" }),
    end_date: dateStrKeep(b, "end_date", existing.end_date, { label: "종료일" }),
    amount: str(b, "amount", { max: 50, label: "금액" }),
    auto_renew: flag(b, "auto_renew"),
    status: oneOf(b, "status", ["active", "expired", "cancelled"] as const, { default: "active", label: "상태" }),
    notes: str(b, "notes", { max: 2000, label: "비고" }),
    team_id: ownerTeamId,
  });
  const contract = db.prepare(`
    SELECT c.*, v.vendor_name, t.team_name AS owner_team_name FROM contracts c
    LEFT JOIN vendors v ON c.vendor_id = v.id LEFT JOIN teams t ON c.team_id = t.id WHERE c.id = ?
  `).get(id) as ContractRow & { vendor_name: string | null; owner_team_name: string | null };
  return NextResponse.json(contract);
});

export const DELETE = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "contracts");
  const id = pathId((await params).id);
  const db = getDb();
  const existing = db.prepare("SELECT * FROM contracts WHERE id = ?").get(id) as ContractRow | undefined;
  if (!existing) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
  assertCanDelete(actor, existing.team_id ?? null);
  db.prepare("DELETE FROM contracts WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
});

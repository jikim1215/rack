import { getDb } from "@/lib/db";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, assertCanWrite, scopeWhere } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const actor = await getActor();
  try { assertCanRead(actor); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
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
  `).all(...scope.params);
  return NextResponse.json(contracts);
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
  const db = getDb();
  if (ownerTeamId != null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId)) {
    return NextResponse.json({ error: "존재하지 않는 팀입니다." }, { status: 400 });
  }
  const result = db.prepare(`
    INSERT INTO contracts (vendor_id, contract_name, contract_type, start_date, end_date, amount, auto_renew, notes, team_id)
    VALUES (@vendor_id, @contract_name, @contract_type, @start_date, @end_date, @amount, @auto_renew, @notes, @team_id)
  `).run({
    vendor_id: body.vendor_id || null,
    contract_name: body.contract_name,
    contract_type: body.contract_type || "maintenance",
    start_date: body.start_date || "",
    end_date: body.end_date || "",
    amount: body.amount || "",
    auto_renew: body.auto_renew ? 1 : 0,
    notes: body.notes || "",
    team_id: ownerTeamId,
  });
  const contract = db.prepare(`
    SELECT c.*, v.vendor_name, t.team_name AS owner_team_name FROM contracts c
    LEFT JOIN vendors v ON c.vendor_id = v.id LEFT JOIN teams t ON c.team_id = t.id WHERE c.id = ?
  `).get(result.lastInsertRowid);
  return NextResponse.json(contract, { status: 201 });
}

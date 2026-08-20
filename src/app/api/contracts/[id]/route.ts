import { getDb } from "@/lib/db";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanWrite, assertCanDelete } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  const existing = db.prepare("SELECT * FROM contracts WHERE id = ?").get(Number(id)) as any;
  if (!existing) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
  try { assertCanWrite(actor, existing.team_id ?? null); } catch (e) { const r = authzError(e); if (r) return r; throw e; }

  let ownerTeamId: number | null = existing.team_id ?? null;
  if (actor?.role === "admin" && "team_id" in body) {
    ownerTeamId = body.team_id === "" || body.team_id == null ? null : Number(body.team_id);
    if (ownerTeamId != null && !db.prepare("SELECT id FROM teams WHERE id = ?").get(ownerTeamId)) {
      return NextResponse.json({ error: "존재하지 않는 팀입니다." }, { status: 400 });
    }
  }
  db.prepare(`
    UPDATE contracts SET vendor_id = @vendor_id, contract_name = @contract_name,
      contract_type = @contract_type, start_date = @start_date, end_date = @end_date,
      amount = @amount, auto_renew = @auto_renew, status = @status, notes = @notes, team_id = @team_id
    WHERE id = @id
  `).run({
    id: Number(id),
    vendor_id: body.vendor_id || null,
    contract_name: body.contract_name,
    contract_type: body.contract_type || "maintenance",
    start_date: body.start_date || "",
    end_date: body.end_date || "",
    amount: body.amount || "",
    auto_renew: body.auto_renew ? 1 : 0,
    status: body.status || "active",
    notes: body.notes || "",
    team_id: ownerTeamId,
  });
  const contract = db.prepare(`
    SELECT c.*, v.vendor_name, t.team_name AS owner_team_name FROM contracts c
    LEFT JOIN vendors v ON c.vendor_id = v.id LEFT JOIN teams t ON c.team_id = t.id WHERE c.id = ?
  `).get(Number(id));
  return NextResponse.json(contract);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM contracts WHERE id = ?").get(Number(id)) as any;
  if (!existing) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
  try { assertCanDelete(actor, existing.team_id ?? null); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  db.prepare("DELETE FROM contracts WHERE id = ?").run(Number(id));
  return NextResponse.json({ success: true });
}

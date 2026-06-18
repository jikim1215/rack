import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  db.prepare(`
    UPDATE contracts SET vendor_id = @vendor_id, contract_name = @contract_name,
      contract_type = @contract_type, start_date = @start_date, end_date = @end_date,
      amount = @amount, auto_renew = @auto_renew, status = @status, notes = @notes
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
  });
  const contract = db.prepare(`
    SELECT c.*, v.vendor_name FROM contracts c
    LEFT JOIN vendors v ON c.vendor_id = v.id WHERE c.id = ?
  `).get(Number(id));
  return NextResponse.json(contract);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM contracts WHERE id = ?").run(Number(id));
  return NextResponse.json({ success: true });
}

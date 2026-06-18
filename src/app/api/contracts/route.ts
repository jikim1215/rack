import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  const contracts = db.prepare(`
    SELECT c.*, v.vendor_name
    FROM contracts c
    LEFT JOIN vendors v ON c.vendor_id = v.id
    ORDER BY c.end_date
  `).all();
  return NextResponse.json(contracts);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO contracts (vendor_id, contract_name, contract_type, start_date, end_date, amount, auto_renew, notes)
    VALUES (@vendor_id, @contract_name, @contract_type, @start_date, @end_date, @amount, @auto_renew, @notes)
  `).run({
    vendor_id: body.vendor_id || null,
    contract_name: body.contract_name,
    contract_type: body.contract_type || "maintenance",
    start_date: body.start_date || "",
    end_date: body.end_date || "",
    amount: body.amount || "",
    auto_renew: body.auto_renew ? 1 : 0,
    notes: body.notes || "",
  });
  const contract = db.prepare(`
    SELECT c.*, v.vendor_name FROM contracts c
    LEFT JOIN vendors v ON c.vendor_id = v.id WHERE c.id = ?
  `).get(result.lastInsertRowid);
  return NextResponse.json(contract, { status: 201 });
}

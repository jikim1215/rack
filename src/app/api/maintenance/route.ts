import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  const logs = db.prepare(`
    SELECT ml.*, a.asset_name, v.vendor_name
    FROM maintenance_logs ml
    LEFT JOIN assets a ON ml.asset_id = a.id
    LEFT JOIN vendors v ON ml.vendor_id = v.id
    ORDER BY ml.created_at DESC
  `).all();
  return NextResponse.json(logs);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO maintenance_logs (asset_id, log_type, occurred_at, severity, symptom, action_taken, vendor_id, cost, notes, status, reported_by)
    VALUES (@asset_id, @log_type, @occurred_at, @severity, @symptom, @action_taken, @vendor_id, @cost, @notes, 'open', @reported_by)
  `).run({
    asset_id: body.asset_id,
    log_type: body.log_type || "failure",
    occurred_at: body.occurred_at || "",
    severity: body.severity || "minor",
    symptom: body.symptom || "",
    action_taken: body.action_taken || "",
    vendor_id: body.vendor_id || null,
    cost: body.cost || "",
    notes: body.notes || "",
    reported_by: session.username,
  });
  const log = db.prepare(`
    SELECT ml.*, a.asset_name, v.vendor_name
    FROM maintenance_logs ml
    LEFT JOIN assets a ON ml.asset_id = a.id
    LEFT JOIN vendors v ON ml.vendor_id = v.id
    WHERE ml.id = ?
  `).get(result.lastInsertRowid);
  return NextResponse.json(log, { status: 201 });
}

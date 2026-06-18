import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  const movements = db.prepare(`
    SELECT m.*, a.asset_name
    FROM asset_movements m
    LEFT JOIN assets a ON m.asset_id = a.id
    ORDER BY m.created_at DESC
  `).all();
  return NextResponse.json(movements);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const db = getDb();

  const result = db.prepare(`
    INSERT INTO asset_movements (
      movement_type, movement_date, asset_id, requester, approver,
      department, purpose, destination, equipment_desc, serial_number,
      notes, status, created_by
    ) VALUES (
      @movement_type, @movement_date, @asset_id, @requester, @approver,
      @department, @purpose, @destination, @equipment_desc, @serial_number,
      @notes, 'requested', @created_by
    )
  `).run({
    movement_type: body.movement_type,
    movement_date: body.movement_date || "",
    asset_id: body.asset_id || null,
    requester: body.requester || "",
    approver: body.approver || "",
    department: body.department || "",
    purpose: body.purpose || "",
    destination: body.destination || "",
    equipment_desc: body.equipment_desc || "",
    serial_number: body.serial_number || "",
    notes: body.notes || "",
    created_by: session.username,
  });

  const movement = db.prepare(`
    SELECT m.*, a.asset_name
    FROM asset_movements m
    LEFT JOIN assets a ON m.asset_id = a.id
    WHERE m.id = ?
  `).get(result.lastInsertRowid);

  return NextResponse.json(movement, { status: 201 });
}

import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  db.prepare(
    "UPDATE racks SET location_id = @location_id, rack_name = @rack_name, total_units = @total_units, description = @description WHERE id = @id"
  ).run({
    id: Number(id),
    location_id: body.location_id,
    rack_name: body.rack_name || body.name,
    total_units: body.total_units || 42,
    description: body.description || "",
  });
  const rack = db.prepare(`
    SELECT r.*, l.location_name
    FROM racks r LEFT JOIN locations l ON r.location_id = l.id
    WHERE r.id = ?
  `).get(Number(id));
  return NextResponse.json(rack);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM racks WHERE id = ?").run(Number(id));
  return NextResponse.json({ ok: true });
}

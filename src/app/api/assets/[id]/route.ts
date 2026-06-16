import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  db.prepare(`
    UPDATE assets SET
      asset_type = @asset_type, name = @name, manufacturer = @manufacturer,
      model = @model, serial_number = @serial_number, ip_address = @ip_address,
      asset_tag = @asset_tag, status = @status, rack_id = @rack_id,
      rack_unit_start = @rack_unit_start, rack_unit_size = @rack_unit_size,
      description = @description, updated_at = datetime('now','localtime')
    WHERE id = @id
  `).run({
    id: Number(id),
    asset_type: body.asset_type,
    name: body.name,
    manufacturer: body.manufacturer || "",
    model: body.model || "",
    serial_number: body.serial_number || "",
    ip_address: body.ip_address || "",
    asset_tag: body.asset_tag || "",
    status: body.status || "active",
    rack_id: body.rack_id || null,
    rack_unit_start: body.rack_unit_start || null,
    rack_unit_size: body.rack_unit_size || 1,
    description: body.description || "",
  });

  const asset = db.prepare(`
    SELECT a.*, r.name as rack_name, l.name as location_name
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id
    WHERE a.id = ?
  `).get(Number(id));

  return NextResponse.json(asset);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM assets WHERE id = ?").run(Number(id));
  return NextResponse.json({ ok: true });
}

import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const asset = db.prepare(`
    SELECT a.*, r.name as rack_name, l.name as location_name
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id
    WHERE a.id = ?
  `).get(Number(id));

  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 커스텀 필드 값
  const customValues = db.prepare(`
    SELECT cv.field_id, cv.value, cf.field_key, cf.field_label
    FROM custom_values cv
    JOIN custom_fields cf ON cv.field_id = cf.id
    WHERE cv.asset_id = ?
  `).all(Number(id));

  return NextResponse.json({ ...asset as any, custom_values: customValues });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  db.prepare(`
    UPDATE assets SET
      asset_type = @asset_type, name = @name, manufacturer = @manufacturer,
      model = @model, serial_number = @serial_number, ip_address = @ip_address,
      asset_tag = @asset_tag, status = @status,
      os = @os, access_ip = @access_ip, user_name = @user_name,
      admin_name = @admin_name, department = @department,
      rack_id = @rack_id, rack_unit_start = @rack_unit_start, rack_unit_size = @rack_unit_size,
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
    os: body.os || "",
    access_ip: body.access_ip || "",
    user_name: body.user_name || "",
    admin_name: body.admin_name || "",
    department: body.department || "",
    rack_id: body.rack_id || null,
    rack_unit_start: body.rack_unit_start || null,
    rack_unit_size: body.rack_unit_size || 1,
    description: body.description || "",
  });

  // 커스텀 필드 저장
  if (body.custom_values && typeof body.custom_values === "object") {
    const upsert = db.prepare(`
      INSERT INTO custom_values (asset_id, field_id, value)
      VALUES (?, ?, ?)
      ON CONFLICT(asset_id, field_id) DO UPDATE SET value = excluded.value
    `);
    const del = db.prepare("DELETE FROM custom_values WHERE asset_id = ? AND field_id = ?");
    for (const [fieldId, value] of Object.entries(body.custom_values)) {
      if (value !== undefined && String(value) !== "") {
        upsert.run(Number(id), Number(fieldId), String(value));
      } else {
        del.run(Number(id), Number(fieldId));
      }
    }
  }

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

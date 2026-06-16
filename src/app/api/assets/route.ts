import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  const assets = db.prepare(`
    SELECT a.*, r.name as rack_name, l.name as location_name
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id
    ORDER BY a.created_at DESC
  `).all();
  return NextResponse.json(assets);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO assets (asset_type, name, manufacturer, model, serial_number, ip_address, asset_tag, status,
      os, access_ip, user_name, admin_name, department,
      rack_id, rack_unit_start, rack_unit_size, description)
    VALUES (@asset_type, @name, @manufacturer, @model, @serial_number, @ip_address, @asset_tag, @status,
      @os, @access_ip, @user_name, @admin_name, @department,
      @rack_id, @rack_unit_start, @rack_unit_size, @description)
  `).run({
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

  const assetId = result.lastInsertRowid;

  // 커스텀 필드 저장
  if (body.custom_values && typeof body.custom_values === "object") {
    const upsert = db.prepare(`
      INSERT INTO custom_values (asset_id, field_id, value)
      VALUES (?, ?, ?)
      ON CONFLICT(asset_id, field_id) DO UPDATE SET value = excluded.value
    `);
    for (const [fieldId, value] of Object.entries(body.custom_values)) {
      if (value !== undefined && value !== "") {
        upsert.run(assetId, Number(fieldId), String(value));
      }
    }
  }

  const asset = db.prepare(`
    SELECT a.*, r.name as rack_name, l.name as location_name
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id
    WHERE a.id = ?
  `).get(assetId);

  return NextResponse.json(asset, { status: 201 });
}

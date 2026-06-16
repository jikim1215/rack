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
    INSERT INTO assets (asset_type, name, manufacturer, model, serial_number, ip_address, asset_tag, status, rack_id, rack_unit_start, rack_unit_size, description)
    VALUES (@asset_type, @name, @manufacturer, @model, @serial_number, @ip_address, @asset_tag, @status, @rack_id, @rack_unit_start, @rack_unit_size, @description)
  `).run({
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
  `).get(result.lastInsertRowid);

  return NextResponse.json(asset, { status: 201 });
}

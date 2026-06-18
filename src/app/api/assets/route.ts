import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  const assets = db.prepare(`
    SELECT a.*, r.rack_name, l.location_name
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
    INSERT INTO assets (asset_type, asset_name, manufacturer, model, serial_number, ip_address, asset_tag, status,
      os, access_ip, user_name, admin_name, department,
      purchase_date, warranty_date, eos_date,
      rack_id, rack_unit_start, rack_unit_size, description)
    VALUES (@asset_type, @asset_name, @manufacturer, @model, @serial_number, @ip_address, @asset_tag, @status,
      @os, @access_ip, @user_name, @admin_name, @department,
      @purchase_date, @warranty_date, @eos_date,
      @rack_id, @rack_unit_start, @rack_unit_size, @description)
  `).run({
    asset_type: body.asset_type,
    asset_name: body.asset_name || body.name,
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
    purchase_date: body.purchase_date || "",
    warranty_date: body.warranty_date || "",
    eos_date: body.eos_date || "",
    rack_id: body.rack_id || null,
    rack_unit_start: body.rack_unit_start || null,
    rack_unit_size: body.rack_unit_size || 1,
    description: body.description || "",
  });

  const assetId = result.lastInsertRowid;

  // 다중 IP 저장
  if (body.ips && Array.isArray(body.ips)) {
    const insertIp = db.prepare(`
      INSERT INTO asset_ips (asset_id, ip_address, ip_type, interface_name, subnet_mask, gateway, is_primary, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const ip of body.ips) {
      if (ip.ip_address) {
        insertIp.run(assetId, ip.ip_address, ip.ip_type || "service", ip.interface_name || "",
          ip.subnet_mask || "", ip.gateway || "", ip.is_primary ? 1 : 0, ip.description || "");
      }
    }
    // primary IP를 assets.ip_address에 동기화
    const primary = body.ips.find((ip: any) => ip.is_primary);
    if (primary) {
      db.prepare("UPDATE assets SET ip_address = ? WHERE id = ?").run(primary.ip_address, assetId);
    }
  }

  // 커스텀 필드 저장
  if (body.custom_values && typeof body.custom_values === "object") {
    const upsert = db.prepare(`
      INSERT INTO custom_values (asset_id, field_id, value) VALUES (?, ?, ?)
      ON CONFLICT(asset_id, field_id) DO UPDATE SET value = excluded.value
    `);
    for (const [fieldId, value] of Object.entries(body.custom_values)) {
      if (value !== undefined && value !== "") {
        upsert.run(assetId, Number(fieldId), String(value));
      }
    }
  }

  const asset = db.prepare(`
    SELECT a.*, r.rack_name, l.location_name
    FROM assets a LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id WHERE a.id = ?
  `).get(assetId);

  return NextResponse.json(asset, { status: 201 });
}

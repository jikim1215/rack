import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  const fields = db.prepare("SELECT * FROM custom_fields WHERE is_active = 1 ORDER BY sort_order, id").all();
  return NextResponse.json(fields);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();

  const result = db.prepare(`
    INSERT INTO custom_fields (field_key, field_label, field_type, options, asset_types, sort_order)
    VALUES (@field_key, @field_label, @field_type, @options, @asset_types, @sort_order)
  `).run({
    field_key: body.field_key,
    field_label: body.field_label,
    field_type: body.field_type || "text",
    options: body.options || "",
    asset_types: body.asset_types || "",
    sort_order: body.sort_order || 0,
  });

  const field = db.prepare("SELECT * FROM custom_fields WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(field, { status: 201 });
}

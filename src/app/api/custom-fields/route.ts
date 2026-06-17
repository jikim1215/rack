import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  const fields = db.prepare("SELECT * FROM custom_fields WHERE is_active = 1 ORDER BY field_group, sort_order, id").all();
  return NextResponse.json(fields);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();

  const result = db.prepare(`
    INSERT INTO custom_fields (field_key, field_label, field_type, field_group, options, asset_types, sort_order, is_required, show_in_table, show_in_detail)
    VALUES (@field_key, @field_label, @field_type, @field_group, @options, @asset_types, @sort_order, @is_required, @show_in_table, @show_in_detail)
  `).run({
    field_key: body.field_key,
    field_label: body.field_label,
    field_type: body.field_type || "text",
    field_group: body.field_group || "기본",
    options: body.options || "",
    asset_types: body.asset_types || "",
    sort_order: body.sort_order || 0,
    is_required: body.is_required || 0,
    show_in_table: body.show_in_table || 0,
    show_in_detail: body.show_in_detail !== undefined ? body.show_in_detail : 1,
  });

  const field = db.prepare("SELECT * FROM custom_fields WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(field, { status: 201 });
}

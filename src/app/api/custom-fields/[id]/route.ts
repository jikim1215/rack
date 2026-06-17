import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  db.prepare(`
    UPDATE custom_fields SET
      field_label = @field_label, field_type = @field_type, field_group = @field_group,
      options = @options, asset_types = @asset_types, sort_order = @sort_order,
      is_required = @is_required, show_in_table = @show_in_table, show_in_detail = @show_in_detail
    WHERE id = @id
  `).run({
    id: Number(id),
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

  const field = db.prepare("SELECT * FROM custom_fields WHERE id = ?").get(Number(id));
  return NextResponse.json(field);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare("UPDATE custom_fields SET is_active = 0 WHERE id = ?").run(Number(id));
  return NextResponse.json({ ok: true });
}

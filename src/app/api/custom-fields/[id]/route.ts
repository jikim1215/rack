import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  db.prepare(`
    UPDATE custom_fields SET
      field_label = @field_label, field_type = @field_type,
      options = @options, asset_types = @asset_types,
      sort_order = @sort_order
    WHERE id = @id
  `).run({
    id: Number(id),
    field_label: body.field_label,
    field_type: body.field_type || "text",
    options: body.options || "",
    asset_types: body.asset_types || "",
    sort_order: body.sort_order || 0,
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

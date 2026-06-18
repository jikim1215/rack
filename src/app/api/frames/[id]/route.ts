import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const frame = db.prepare("SELECT * FROM dist_frames WHERE id = ?").get(Number(id));
  if (!frame) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const pairs = db.prepare(
    "SELECT * FROM frame_pairs WHERE frame_id = ? ORDER BY pair_number"
  ).all(Number(id));

  return NextResponse.json({ ...(frame as any), pairs });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  db.prepare(`
    UPDATE dist_frames SET
      location_id = @location_id,
      rack_id = @rack_id,
      frame_name = @frame_name,
      frame_type = @frame_type,
      total_pairs = @total_pairs,
      description = @description
    WHERE id = @id
  `).run({
    id: Number(id),
    location_id: body.location_id,
    rack_id: body.rack_id || null,
    frame_name: body.frame_name || body.name,
    frame_type: body.frame_type || "110block",
    total_pairs: body.total_pairs || 50,
    description: body.description || "",
  });

  const frame = db.prepare("SELECT * FROM dist_frames WHERE id = ?").get(Number(id));
  return NextResponse.json(frame);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM dist_frames WHERE id = ?").run(Number(id));
  return NextResponse.json({ ok: true });
}

import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  db.prepare(
    "UPDATE locations SET location_name = @location_name, building = @building, floor = @floor, room = @room WHERE id = @id"
  ).run({ id: Number(id), location_name: body.location_name || body.name, building: body.building || "", floor: body.floor || "", room: body.room || "" });
  const loc = db.prepare("SELECT * FROM locations WHERE id = ?").get(Number(id));
  return NextResponse.json(loc);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM locations WHERE id = ?").run(Number(id));
  return NextResponse.json({ ok: true });
}

import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  const locations = db.prepare("SELECT * FROM locations ORDER BY name").all();
  return NextResponse.json(locations);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();
  const result = db.prepare(
    "INSERT INTO locations (name, building, floor, room) VALUES (@name, @building, @floor, @room)"
  ).run({
    name: body.name,
    building: body.building || "",
    floor: body.floor || "",
    room: body.room || "",
  });
  const loc = db.prepare("SELECT * FROM locations WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(loc, { status: 201 });
}

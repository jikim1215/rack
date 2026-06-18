import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  const locations = db.prepare("SELECT * FROM locations ORDER BY location_name").all();
  return NextResponse.json(locations);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const db = getDb();
  const result = db.prepare(
    "INSERT INTO locations (location_name, building, floor, room) VALUES (@location_name, @building, @floor, @room)"
  ).run({
    location_name: body.location_name || body.name,
    building: body.building || "",
    floor: body.floor || "",
    room: body.room || "",
  });
  const loc = db.prepare("SELECT * FROM locations WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(loc, { status: 201 });
}

import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  const racks = db.prepare(`
    SELECT r.*, l.name as location_name
    FROM racks r LEFT JOIN locations l ON r.location_id = l.id
    ORDER BY r.name
  `).all();
  return NextResponse.json(racks);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();
  const result = db.prepare(
    "INSERT INTO racks (location_id, name, total_units, description) VALUES (@location_id, @name, @total_units, @description)"
  ).run({
    location_id: body.location_id,
    name: body.name,
    total_units: body.total_units || 42,
    description: body.description || "",
  });
  const rack = db.prepare(`
    SELECT r.*, l.name as location_name
    FROM racks r LEFT JOIN locations l ON r.location_id = l.id
    WHERE r.id = ?
  `).get(result.lastInsertRowid);
  return NextResponse.json(rack, { status: 201 });
}

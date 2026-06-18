import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  const frames = db.prepare(`
    SELECT df.*, l.location_name, l.building, l.floor
    FROM dist_frames df
    LEFT JOIN locations l ON df.location_id = l.id
    ORDER BY l.building, l.floor, df.frame_name
  `).all();
  return NextResponse.json(frames);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const db = getDb();

  const insert = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO dist_frames (location_id, rack_id, frame_name, frame_type, total_pairs, description)
      VALUES (@location_id, @rack_id, @frame_name, @frame_type, @total_pairs, @description)
    `).run({
      location_id: body.location_id,
      rack_id: body.rack_id || null,
      frame_name: body.frame_name || body.name,
      frame_type: body.frame_type || "110block",
      total_pairs: body.total_pairs || 50,
      description: body.description || "",
    });

    const frameId = result.lastInsertRowid;
    const totalPairs = body.total_pairs || 50;

    const insertPair = db.prepare(`
      INSERT INTO frame_pairs (frame_id, pair_number) VALUES (?, ?)
    `);
    for (let i = 1; i <= totalPairs; i++) {
      insertPair.run(frameId, i);
    }

    return frameId;
  });

  const frameId = insert();

  const frame = db.prepare("SELECT * FROM dist_frames WHERE id = ?").get(frameId);
  return NextResponse.json(frame, { status: 201 });
}

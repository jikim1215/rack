import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const pairs = db.prepare(
    "SELECT * FROM frame_pairs WHERE frame_id = ? ORDER BY pair_number"
  ).all(Number(id));
  return NextResponse.json(pairs);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  const updatePairs = db.transaction(() => {
    const update = db.prepare(`
      UPDATE frame_pairs SET
        status = @status,
        label = @label,
        source = @source,
        destination = @destination,
        cable_id = @cable_id,
        user_info = @user_info
      WHERE id = @id AND frame_id = @frame_id
    `);

    for (const pair of body.pairs) {
      update.run({
        id: pair.id,
        frame_id: Number(id),
        status: pair.status || "unused",
        label: pair.label || "",
        source: pair.source || "",
        destination: pair.destination || "",
        cable_id: pair.cable_id || "",
        user_info: pair.user_info || "",
      });
    }
  });

  updatePairs();

  const pairs = db.prepare(
    "SELECT * FROM frame_pairs WHERE frame_id = ? ORDER BY pair_number"
  ).all(Number(id));
  return NextResponse.json(pairs);
}

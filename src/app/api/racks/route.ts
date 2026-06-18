import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  const racks = db.prepare(`
    SELECT r.*, l.location_name,
      COALESCE((SELECT COUNT(*) FROM assets WHERE rack_id = r.id), 0) as asset_count,
      COALESCE((SELECT SUM(rack_unit_size) FROM assets WHERE rack_id = r.id), 0) as used_units
    FROM racks r LEFT JOIN locations l ON r.location_id = l.id
    ORDER BY r.rack_name
  `).all();
  return NextResponse.json(racks);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const db = getDb();

  // 입력 검증
  const rackName = (body.rack_name || body.name || "").trim();
  if (!rackName) return NextResponse.json({ error: "랙 이름은 필수입니다." }, { status: 400 });

  const totalUnits = Number(body.total_units) || 42;
  if (totalUnits < 1) return NextResponse.json({ error: "총 유닛 수는 1 이상이어야 합니다." }, { status: 400 });

  const locId = Number(body.location_id);
  const loc = db.prepare("SELECT id FROM locations WHERE id = ?").get(locId);
  if (!loc) return NextResponse.json({ error: "존재하지 않는 위치입니다." }, { status: 400 });

  const dup = db.prepare(
    "SELECT id FROM racks WHERE location_id = ? AND rack_name = ?"
  ).get(locId, rackName);
  if (dup) {
    return NextResponse.json({ error: `동일 위치에 '${rackName}' 랙이 이미 존재합니다.` }, { status: 409 });
  }

  const result = db.prepare(
    "INSERT INTO racks (location_id, rack_name, total_units, description) VALUES (?, ?, ?, ?)"
  ).run(locId, rackName, totalUnits, body.description || "");

  const rack = db.prepare(`
    SELECT r.*, l.location_name, 0 as asset_count, 0 as used_units
    FROM racks r LEFT JOIN locations l ON r.location_id = l.id WHERE r.id = ?
  `).get(result.lastInsertRowid);

  logAudit(db, {
    entityType: "rack", entityId: Number(result.lastInsertRowid), entityName: rackName,
    action: "create", changedBy: session?.username || "system",
    newData: { rack_name: rackName, total_units: totalUnits, location_id: locId },
  });

  return NextResponse.json(rack, { status: 201 });
}

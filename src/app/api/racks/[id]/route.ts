import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { validateRackResize } from "@/lib/rack-validation";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  // 존재 확인
  const existing = db.prepare("SELECT * FROM racks WHERE id = ?").get(Number(id)) as any;
  if (!existing) return NextResponse.json({ error: "랙을 찾을 수 없습니다." }, { status: 404 });

  // 입력 검증
  const rackName = (body.rack_name || body.name || "").trim().replace(/\s+/g, " ");
  if (!rackName) return NextResponse.json({ error: "랙 이름은 필수입니다." }, { status: 400 });

  const totalUnits = Number(body.total_units) || 42;
  if (totalUnits < 1) return NextResponse.json({ error: "총 유닛 수는 1 이상이어야 합니다." }, { status: 400 });

  // total_units 축소 시 기존 자산 범위 검증
  if (totalUnits < existing.total_units) {
    const err = validateRackResize(db, Number(id), totalUnits);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  // 위치 존재 확인
  if (body.location_id) {
    const loc = db.prepare("SELECT id FROM locations WHERE id = ?").get(Number(body.location_id));
    if (!loc) return NextResponse.json({ error: "존재하지 않는 위치입니다." }, { status: 400 });
  }

  const dupRack = db.prepare(
    "SELECT id FROM racks WHERE location_id = ? AND UPPER(rack_name) = UPPER(?) AND id != ?"
  ).get(body.location_id || existing.location_id, rackName, Number(id));
  if (dupRack) {
    return NextResponse.json({ error: `동일 위치에 '${rackName}' 랙이 이미 존재합니다.` }, { status: 409 });
  }

  db.prepare(
    "UPDATE racks SET location_id = @location_id, rack_name = @rack_name, total_units = @total_units, description = @description WHERE id = @id"
  ).run({
    id: Number(id),
    location_id: body.location_id || existing.location_id,
    rack_name: rackName,
    total_units: totalUnits,
    description: body.description ?? existing.description,
  });

  const rack = db.prepare(`
    SELECT r.*, l.location_name,
      COALESCE((SELECT COUNT(*) FROM assets WHERE rack_id = r.id), 0) as asset_count,
      COALESCE((SELECT SUM(rack_unit_size) FROM assets WHERE rack_id = r.id), 0) as used_units
    FROM racks r LEFT JOIN locations l ON r.location_id = l.id WHERE r.id = ?
  `).get(Number(id));

  logAudit(db, {
    entityType: "rack", entityId: Number(id), entityName: rackName,
    action: "update", changedBy: session?.username || "system",
    oldData: { rack_name: existing.rack_name, total_units: existing.total_units, location_id: existing.location_id },
    newData: { rack_name: rackName, total_units: totalUnits, location_id: body.location_id || existing.location_id },
  });

  return NextResponse.json(rack);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();

  const existing = db.prepare("SELECT * FROM racks WHERE id = ?").get(Number(id)) as any;
  const affectedCount = (db.prepare("SELECT COUNT(*) as c FROM assets WHERE rack_id = ?").get(Number(id)) as any).c;

  db.prepare("DELETE FROM racks WHERE id = ?").run(Number(id));

  if (existing) {
    logAudit(db, {
      entityType: "rack", entityId: Number(id), entityName: existing.rack_name || "",
      action: "delete", changedBy: session?.username || "system",
      oldData: { rack_name: existing.rack_name, total_units: existing.total_units, affectedAssets: affectedCount },
    });
  }

  return NextResponse.json({ ok: true, releasedAssets: affectedCount });
}

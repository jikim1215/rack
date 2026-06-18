import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const db = getDb();

  // 승인/반려는 admin만
  if (
    (body.status === "approved" || body.status === "rejected") &&
    session.role !== "admin"
  ) {
    return NextResponse.json(
      { error: "관리자만 승인/반려할 수 있습니다" },
      { status: 403 }
    );
  }

  const updates: string[] = [];
  const values: Record<string, unknown> = { id: Number(id) };

  if (body.status) {
    updates.push("status = @status");
    values.status = body.status;
  }
  if (body.status === "approved" || body.status === "rejected") {
    updates.push("approver = @approver");
    values.approver = session.username;
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No updates" }, { status: 400 });
  }

  const movement = db.prepare('SELECT * FROM asset_movements WHERE id = ?').get(Number(id)) as any;

  db.prepare(
    `UPDATE asset_movements SET ${updates.join(", ")} WHERE id = @id`
  ).run(values);

  // 반출 완료 → 자산 inactive
  if (body.status === 'completed' && movement?.movement_type === 'bring_out' && movement.asset_id) {
    db.prepare('UPDATE assets SET status = ? WHERE id = ?').run('inactive', movement.asset_id);
  }

  // 반납 완료 → 자산 active 복원
  if (body.status === 'completed' && movement?.movement_type === 'return' && movement.asset_id) {
    db.prepare('UPDATE assets SET status = ? WHERE id = ?').run('active', movement.asset_id);
  }

  // 반입 완료 + 자산 미연결 → 자산 자동 등록
  if (body.status === 'completed' && movement?.movement_type === 'bring_in' && !movement.asset_id) {
    const newAsset = db.prepare(`
      INSERT INTO assets (asset_type, asset_name, serial_number, status, description)
      VALUES ('other', ?, ?, 'active', ?)
    `).run(
      movement.equipment_desc || '반입 장비',
      movement.serial_number || '',
      movement.purpose || ''
    );
    db.prepare('UPDATE asset_movements SET asset_id = ? WHERE id = ?').run(newAsset.lastInsertRowid, Number(id));
  }

  const updated = db.prepare(`
    SELECT m.*, a.asset_name
    FROM asset_movements m
    LEFT JOIN assets a ON m.asset_id = a.id
    WHERE m.id = ?
  `).get(Number(id));

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  db.prepare("DELETE FROM asset_movements WHERE id = ?").run(Number(id));
  return NextResponse.json({ success: true });
}

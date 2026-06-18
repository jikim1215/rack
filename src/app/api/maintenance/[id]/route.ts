import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  const updates: string[] = [];
  const values: any = { id: Number(id) };

  if (body.status) {
    updates.push("status = @status");
    values.status = body.status;
    if (body.status === "resolved") {
      updates.push("resolved_at = datetime('now','localtime')");
    }
    if (body.status === "in_progress" || body.status === "resolved") {
      updates.push("handled_by = @handled_by");
      values.handled_by = session.username;
    }
  }
  if (body.action_taken !== undefined) {
    updates.push("action_taken = @action_taken");
    values.action_taken = body.action_taken;
  }
  if (body.notes !== undefined) {
    updates.push("notes = @notes");
    values.notes = body.notes;
  }

  if (updates.length > 0) {
    // 기존 로그 조회 (상태 연동용)
    const log = db.prepare('SELECT * FROM maintenance_logs WHERE id = ?').get(Number(id)) as any;
    if (!log) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    db.prepare(`UPDATE maintenance_logs SET ${updates.join(", ")} WHERE id = @id`).run(values);

    // 장애 등록(in_progress) → 자산 maintenance 상태
    if (body.status === 'in_progress' && log.log_type === 'failure' && log.asset_id) {
      db.prepare('UPDATE assets SET status = ? WHERE id = ?').run('maintenance', log.asset_id);
    }

    // 장애 해결 → 자산 active 복원
    if (body.status === 'resolved' && log.log_type === 'failure' && log.asset_id) {
      db.prepare('UPDATE assets SET status = ? WHERE id = ?').run('active', log.asset_id);
    }
  }

  const log = db.prepare(`
    SELECT ml.*, a.asset_name, v.vendor_name
    FROM maintenance_logs ml
    LEFT JOIN assets a ON ml.asset_id = a.id
    LEFT JOIN vendors v ON ml.vendor_id = v.id
    WHERE ml.id = ?
  `).get(Number(id));
  return NextResponse.json(log);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM maintenance_logs WHERE id = ?").run(Number(id));
  return NextResponse.json({ ok: true });
}

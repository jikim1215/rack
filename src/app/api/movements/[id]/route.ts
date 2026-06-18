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
  const values: Record<string, unknown> = { id };

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

  db.prepare(
    `UPDATE asset_movements SET ${updates.join(", ")} WHERE id = @id`
  ).run(values);

  const movement = db.prepare(`
    SELECT m.*, a.asset_name
    FROM asset_movements m
    LEFT JOIN assets a ON m.asset_id = a.id
    WHERE m.id = ?
  `).get(id);

  return NextResponse.json(movement);
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
  db.prepare("DELETE FROM asset_movements WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}

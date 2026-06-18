import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const perms = db.prepare('SELECT menu_key, can_access, can_write, can_approve FROM menu_permissions WHERE role = ?').all(session.role);
  const permissions: Record<string, any> = {};
  for (const p of perms as any[]) {
    permissions[p.menu_key] = { can_access: p.can_access, can_write: p.can_write, can_approve: p.can_approve };
  }
  return NextResponse.json({
    userId: session.userId,
    username: session.username,
    displayName: session.displayName,
    role: session.role,
    permissions,
  });
}

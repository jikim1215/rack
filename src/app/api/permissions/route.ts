import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

const FIXED_ACCESS_KEYS = ['dashboard', 'settings'];

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const rows = db.prepare('SELECT * FROM menu_permissions WHERE role = ?').all(session.role) as any[];

  const permissions: Record<string, { can_access: number; can_write: number; can_approve: number }> = {};
  for (const r of rows) {
    permissions[r.menu_key] = {
      can_access: r.can_access,
      can_write: r.can_write,
      can_approve: r.can_approve,
    };
  }

  return NextResponse.json(permissions);
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { role, permissions } = body as {
    role: string;
    permissions: { menu_key: string; can_access: number; can_write: number; can_approve: number }[];
  };

  if (!role || !Array.isArray(permissions)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO menu_permissions (menu_key, role, can_access, can_write, can_approve)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(menu_key, role) DO UPDATE SET
       can_access = excluded.can_access,
       can_write = excluded.can_write,
       can_approve = excluded.can_approve`
  );

  const upsertMany = db.transaction((perms: typeof permissions) => {
    for (const p of perms) {
      const canAccess = FIXED_ACCESS_KEYS.includes(p.menu_key) ? 1 : p.can_access;
      stmt.run(p.menu_key, role, canAccess, p.can_write, p.can_approve);
    }
  });

  upsertMany(permissions);

  return NextResponse.json({ ok: true });
}

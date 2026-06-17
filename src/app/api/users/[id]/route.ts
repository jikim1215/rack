import { getDb } from '@/lib/db';
import { getSession, hashPassword } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const { display_name, role, is_active, password } = await req.json();

  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(id));
  if (!user) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (password) {
    db.prepare('UPDATE users SET display_name = ?, role = ?, is_active = ?, password_hash = ? WHERE id = ?')
      .run(display_name ?? '', role ?? 'user', is_active ?? 1, hashPassword(password), Number(id));
  } else {
    db.prepare('UPDATE users SET display_name = ?, role = ?, is_active = ? WHERE id = ?')
      .run(display_name ?? '', role ?? 'user', is_active ?? 1, Number(id));
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(Number(id));
  return NextResponse.json({ ok: true });
}

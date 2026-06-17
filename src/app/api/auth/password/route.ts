import { getDb } from '@/lib/db';
import { getSession, hashPassword, verifyPassword } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { currentPassword, newPassword } = await req.json();
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: '필수 입력' }, { status: 400 });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId) as any;
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    return NextResponse.json({ error: '현재 비밀번호가 일치하지 않습니다.' }, { status: 400 });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), session.userId);
  return NextResponse.json({ ok: true });
}

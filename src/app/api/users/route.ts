import { getDb } from '@/lib/db';
import { getSession, hashPassword } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  const users = db.prepare('SELECT id, username, display_name, role, is_active, created_at FROM users ORDER BY id').all();
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { username, password, display_name, role } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: '아이디와 비밀번호는 필수입니다.' }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return NextResponse.json({ error: '이미 존재하는 아이디입니다.' }, { status: 400 });
  }

  const stmt = db.prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)');
  const result = stmt.run(username, hashPassword(password), display_name || '', role || 'user');
  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 });
}

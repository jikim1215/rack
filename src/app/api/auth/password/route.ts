import { getDb } from '@/lib/db';
import { getSession, hashPassword, verifyPassword, validatePasswordPolicy, createSessionToken, sessionCookieOptions } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { currentPassword, newPassword } = await req.json();
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: '필수 입력' }, { status: 400 });
  }
  const policyError = validatePasswordPolicy(newPassword);
  if (policyError) {
    return NextResponse.json({ error: policyError }, { status: 400 });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId) as any;
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    return NextResponse.json({ error: '현재 비밀번호가 일치하지 않습니다.' }, { status: 400 });
  }

  // 비밀번호 변경 → token_version 증가로 기존 토큰 무효화 + 강제변경 플래그(must_change_password) 해제.
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?')
    .run(hashPassword(newPassword), session.userId);
  const newTv = (db.prepare('SELECT token_version FROM users WHERE id = ?').get(session.userId) as any).token_version as number;

  // 현재 세션은 새 버전으로 재발급해 로그인 상태 유지
  const token = createSessionToken({
    userId: session.userId,
    username: session.username,
    displayName: session.displayName,
    role: session.role,
    teamId: session.teamId,
    tv: newTv,
  });
  const res = NextResponse.json({ ok: true });
  const opts = sessionCookieOptions();
  res.cookies.set(opts.name, token, {
    httpOnly: opts.httpOnly, secure: opts.secure, sameSite: opts.sameSite, path: opts.path, maxAge: opts.maxAge,
  });
  return res;
}

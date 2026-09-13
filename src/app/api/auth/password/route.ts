import { getDb } from '@/lib/db';
import { getSession, hashPassword, verifyPassword, createSessionToken, sessionCookieOptions } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { withApi, readJson } from "@/lib/api-authz";
import { asBody, str } from '@/lib/validation/input';
import type { UserRow } from '@/lib/db-types';

export const PUT = withApi(async (req: NextRequest) => {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const b = asBody(await readJson(req));
  const currentPassword = str(b, "currentPassword", { required: true, max: 256, label: "현재 비밀번호" });
  const newPassword = str(b, "newPassword", { required: true, max: 256, label: "새 비밀번호" });
  // ⚠ 서버는 평문을 보지 못한다(클라이언트가 sha512 프리해시). 정책(길이·문자종류)은 평문을 아는 클라이언트가
  //   src/lib/password-policy.ts 로 검사한다. 여기서 할 수 있는 건 "정말 프리해시인가"(평문이 실수로 날아오면 거부) 뿐이다.
  //   과거에는 validatePasswordPolicy(해시) 를 호출해 항상 통과하는 허수 검사였다 — 그래서 정책 위반 비밀번호가 들어왔다.
  if (!/^[0-9a-f]{128}$/.test(newPassword) || !/^[0-9a-f]{128}$/.test(currentPassword)) {
    return NextResponse.json({ error: "비밀번호 전송 형식이 올바르지 않습니다(클라이언트 해시 누락)." }, { status: 400 });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId) as UserRow | undefined;
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    return NextResponse.json({ error: '현재 비밀번호가 일치하지 않습니다.' }, { status: 400 });
  }

  // 비밀번호 변경 → token_version 증가로 기존 토큰 무효화 + 강제변경 플래그(must_change_password) 해제.
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?')
    .run(hashPassword(newPassword), session.userId);
  const newTv = (db.prepare('SELECT token_version FROM users WHERE id = ?').get(session.userId) as Pick<UserRow, "token_version">).token_version;

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
});

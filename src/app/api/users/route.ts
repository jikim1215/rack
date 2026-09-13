import { getDb } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertAdmin } from '@/lib/authz';
import { parseRules } from '@/lib/ip-access';
import { validateEmail, normalizeEmail } from '@/lib/user-admin';
import { logAudit } from '@/lib/audit';
import { asBody, str, oneOf, idOrNull, ValidationError } from '@/lib/validation/input';
import type { UserRow } from '@/lib/db-types';

export const GET = withApi(async () => {
  const actor = await getActor();
  assertAdmin(actor);

  const db = getDb();
  const users = db
    .prepare('SELECT id, username, display_name, role, team_id, is_active, allowed_ips, totp_enabled, created_at FROM users ORDER BY id')
    .all() as Pick<UserRow, 'id' | 'username' | 'display_name' | 'role' | 'team_id' | 'is_active' | 'allowed_ips' | 'created_at'>[];
  return NextResponse.json(users);
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertAdmin(actor);

  const b = asBody(await readJson(req));
  const password = str(b, 'password', { required: true, max: 200, label: '비밀번호' });
  const usernameRaw = str(b, 'username', { required: true, max: 200, label: '이메일' });
  const nameError = validateEmail(usernameRaw);
  if (nameError) throw new ValidationError(nameError);
  const trimmedUsername = normalizeEmail(usernameRaw);

  // 서버는 sha512 프리해시만 받는다(평문 정책은 클라이언트 password-policy.ts). 여기서는 프리해시 형식만 검증 — 평문이 실수로 오면 거부.
  if (!/^[0-9a-f]{128}$/.test(password)) throw new ValidationError("비밀번호 전송 형식이 올바르지 않습니다(클라이언트 해시 누락).");

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(trimmedUsername);
  if (existing) throw new ValidationError('이미 존재하는 이메일입니다.');

  const safeRole = oneOf(b, 'role', ['admin', 'team', 'viewer'] as const, { default: 'team', label: '역할' });
  const displayName = str(b, 'display_name', { max: 100, label: '이름' });
  // 팀(team_id)은 team 역할에만 의미가 있다. 다른 역할은 항상 null.
  const rawTeamId = safeRole === 'team' ? idOrNull(b, 'team_id', '팀') : null;
  if (rawTeamId != null && !db.prepare('SELECT id FROM teams WHERE id = ?').get(rawTeamId)) {
    throw new ValidationError('존재하지 않는 팀입니다.');
  }
  // 허용 IP: 유효 규칙만 정규화해 콤마구분 저장 (빈값=IP 제한 없음).
  const allowedIps = parseRules(str(b, 'allowed_ips', { max: 2000 })).join(',');
  const stmt = db.prepare('INSERT INTO users (username, password_hash, display_name, role, team_id, allowed_ips) VALUES (?, ?, ?, ?, ?, ?)');
  const result = stmt.run(trimmedUsername, hashPassword(password), displayName, safeRole, rawTeamId, allowedIps);
  const id = Number(result.lastInsertRowid);

  logAudit(db, {
    entityType: 'user',
    entityId: id,
    entityName: trimmedUsername,
    action: 'create',
    changedBy: actor.username,
    newData: { username: trimmedUsername, display_name: displayName, role: safeRole, team_id: rawTeamId, is_active: 1 },
  });

  return NextResponse.json({ id }, { status: 201 });
});

import { getDb } from '@/lib/db';
import { hashPassword, validatePasswordPolicy } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getActor, authzError } from '@/lib/api-authz';
import { assertAdmin } from '@/lib/authz';
import { parseRules } from '@/lib/ip-access';
import { validateEmail, normalizeEmail } from '@/lib/user-admin';

export async function GET() {
  const actor = await getActor();
  try {
    assertAdmin(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const db = getDb();
  const users = db.prepare('SELECT id, username, display_name, role, team_id, is_active, allowed_ips, created_at FROM users ORDER BY id').all();
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  try {
    assertAdmin(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const { username, password, display_name, role, team_id, allowed_ips } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: '이메일과 비밀번호는 필수입니다.' }, { status: 400 });
  }
  const nameError = validateEmail(username);
  if (nameError) {
    return NextResponse.json({ error: nameError }, { status: 400 });
  }
  const trimmedUsername = normalizeEmail(String(username));

  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    return NextResponse.json({ error: policyError }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(trimmedUsername);
  if (existing) {
    return NextResponse.json({ error: '이미 존재하는 이메일입니다.' }, { status: 400 });
  }

  const allowedRoles = ['admin', 'team', 'viewer'];
  const safeRole = allowedRoles.includes(role) ? role : 'team';
  // 팀(team_id)은 team 역할에만 의미가 있다. 다른 역할은 항상 null.
  const teamId = safeRole === 'team' && team_id != null && team_id !== '' ? Number(team_id) : null;
  if (teamId != null && !db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId)) {
    return NextResponse.json({ error: '존재하지 않는 팀입니다.' }, { status: 400 });
  }
  // 허용 IP: 유효 규칙만 정규화해 콤마구분 저장 (빈값=IP 제한 없음).
  const allowedIps = parseRules(allowed_ips).join(',');
  const stmt = db.prepare('INSERT INTO users (username, password_hash, display_name, role, team_id, allowed_ips) VALUES (?, ?, ?, ?, ?, ?)');
  const result = stmt.run(trimmedUsername, hashPassword(password), display_name || '', safeRole, teamId, allowedIps);
  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 });
}

import { getDb } from '@/lib/db';
import { hashPassword, validatePasswordPolicy } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getActor, authzError } from '@/lib/api-authz';
import { assertAdmin } from '@/lib/authz';
import { parseRules } from '@/lib/ip-access';
import { validateEmail, normalizeEmail, wouldRemoveLastAdmin } from '@/lib/user-admin';

function activeAdminIds(db: ReturnType<typeof getDb>): number[] {
  return (db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all() as { id: number }[])
    .map((r) => r.id);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getActor();
  try {
    assertAdmin(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const { id } = await params;
  const targetId = Number(id);
  const { username, display_name, role, is_active, password, team_id, allowed_ips } = await req.json();

  const db = getDb();
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId) as
    | { id: number; username: string }
    | undefined;
  if (!user) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
  }

  // 이메일(로그인 ID): 전달 시 검증·중복확인 후 변경(고정 계정도 개명 허용). 미전달 시 기존값 유지.
  let nextUsername = user.username;
  if (username !== undefined && username !== null) {
    const nameError = validateEmail(username);
    if (nameError) {
      return NextResponse.json({ error: nameError }, { status: 400 });
    }
    nextUsername = normalizeEmail(String(username));
    const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(nextUsername, targetId);
    if (dup) {
      return NextResponse.json({ error: '이미 존재하는 이메일입니다.' }, { status: 400 });
    }
  }

  if (password != null && password !== '') {
    const policyError = validatePasswordPolicy(password);
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }
  }

  const allowedRoles = ['admin', 'team', 'viewer'];
  const safeRole = allowedRoles.includes(role) ? role : 'team';
  // 팀(team_id)은 team 역할에만 의미가 있다. 다른 역할은 항상 null.
  const teamId = safeRole === 'team' && team_id != null && team_id !== '' ? Number(team_id) : null;
  if (teamId != null && !db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId)) {
    return NextResponse.json({ error: '존재하지 않는 팀입니다.' }, { status: 400 });
  }

  // 잠금 방지: 이 수정으로 활성 관리자가 0명이 되면(역할강등/비활성화) 거부.
  const nextIsActive = (is_active ?? 1) ? 1 : 0;
  const willBeActiveAdmin = safeRole === 'admin' && nextIsActive === 1;
  if (wouldRemoveLastAdmin(activeAdminIds(db), targetId, willBeActiveAdmin)) {
    return NextResponse.json(
      { error: '마지막 관리자 계정은 비활성화하거나 권한을 낮출 수 없습니다.' },
      { status: 400 }
    );
  }

  if (password) {
    // 총괄의 비밀번호 재설정 → token_version 증가로 해당 사용자의 기존 세션 전부 무효화
    db.prepare('UPDATE users SET username = ?, display_name = ?, role = ?, is_active = ?, team_id = ?, password_hash = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?')
      .run(nextUsername, display_name ?? '', safeRole, nextIsActive, teamId, hashPassword(password), targetId);
  } else {
    db.prepare('UPDATE users SET username = ?, display_name = ?, role = ?, is_active = ?, team_id = ? WHERE id = ?')
      .run(nextUsername, display_name ?? '', safeRole, nextIsActive, teamId, targetId);
  }
  // 허용 IP: 유효 규칙만 정규화(빈값=제한없음). 미전달 시 기존값 유지.
  if (allowed_ips !== undefined) {
    db.prepare('UPDATE users SET allowed_ips = ? WHERE id = ?').run(parseRules(allowed_ips).join(','), targetId);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getActor();
  try {
    assertAdmin(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const { id } = await params;
  const targetId = Number(id);
  const db = getDb();

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!user) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
  }

  // 본인 계정은 삭제 불가(현재 세션이 즉시 파괴되는 사고 방지).
  if (actor && actor.userId === targetId) {
    return NextResponse.json({ error: '현재 로그인한 본인 계정은 삭제할 수 없습니다.' }, { status: 400 });
  }

  // 잠금 방지: 마지막 활성 관리자는 삭제 불가.
  if (wouldRemoveLastAdmin(activeAdminIds(db), targetId, false)) {
    return NextResponse.json({ error: '마지막 관리자 계정은 삭제할 수 없습니다.' }, { status: 400 });
  }

  // 하드 삭제. audit_logs/access_logs 는 username 을 별도 보존하므로 이력은 남는다.
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  return NextResponse.json({ ok: true });
}

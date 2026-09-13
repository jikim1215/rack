import { getDb } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertAdmin } from '@/lib/authz';
import { parseRules } from '@/lib/ip-access';
import { validateEmail, normalizeEmail, wouldRemoveLastAdmin } from '@/lib/user-admin';
import { logAudit } from '@/lib/audit';
import { asBody, str, oneOf, idOrNull, flag, pathId, ValidationError } from '@/lib/validation/input';
import type { UserRow } from '@/lib/db-types';

type Ctx = { params: Promise<{ id: string }> };

function activeAdminIds(db: ReturnType<typeof getDb>): number[] {
  return (db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all() as { id: number }[])
    .map((r) => r.id);
}

export const PUT = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertAdmin(actor);

  const targetId = pathId((await params).id);
  const b = asBody(await readJson(req));

  const db = getDb();
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId) as
    | Pick<UserRow, 'id' | 'username'>
    | undefined;
  if (!user) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
  }
  const oldRow = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) as UserRow;

  // 이메일(로그인 ID): 전달 시 검증·중복확인 후 변경(고정 계정도 개명 허용). 미전달 시 기존값 유지.
  let nextUsername = user.username;
  if (b.username !== undefined && b.username !== null) {
    const usernameRaw = str(b, 'username', { max: 200, label: '이메일' });
    const nameError = validateEmail(usernameRaw);
    if (nameError) throw new ValidationError(nameError);
    nextUsername = normalizeEmail(usernameRaw);
    const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(nextUsername, targetId);
    if (dup) throw new ValidationError('이미 존재하는 이메일입니다.');
  }

  const password = str(b, 'password', { max: 200 });
  // 서버는 sha512 프리해시만 받는다(평문 정책은 클라이언트). 프리해시 형식만 검증.
  if (password && !/^[0-9a-f]{128}$/.test(password)) throw new ValidationError("비밀번호 전송 형식이 올바르지 않습니다(클라이언트 해시 누락).");

  const safeRole = oneOf(b, 'role', ['admin', 'team', 'viewer'] as const, { default: 'team', label: '역할' });
  const displayName = str(b, 'display_name', { max: 100, label: '이름' });
  // 팀(team_id)은 team 역할에만 의미가 있다. 다른 역할은 항상 null.
  const rawTeamId = safeRole === 'team' ? idOrNull(b, 'team_id', '팀') : null;
  if (rawTeamId != null && !db.prepare('SELECT id FROM teams WHERE id = ?').get(rawTeamId)) {
    throw new ValidationError('존재하지 않는 팀입니다.');
  }

  // 잠금 방지: 이 수정으로 활성 관리자가 0명이 되면(역할강등/비활성화) 거부.
  const nextIsActive = flag(b, 'is_active', 1);
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
      .run(nextUsername, displayName, safeRole, nextIsActive, rawTeamId, hashPassword(password), targetId);
  } else {
    db.prepare('UPDATE users SET username = ?, display_name = ?, role = ?, is_active = ?, team_id = ? WHERE id = ?')
      .run(nextUsername, displayName, safeRole, nextIsActive, rawTeamId, targetId);
  }
  // 허용 IP: 유효 규칙만 정규화(빈값=제한없음). 미전달 시 기존값 유지.
  let allowedIps = oldRow.allowed_ips;
  if (b.allowed_ips !== undefined) {
    allowedIps = parseRules(str(b, 'allowed_ips', { max: 2000 })).join(',');
    db.prepare('UPDATE users SET allowed_ips = ? WHERE id = ?').run(allowedIps, targetId);
  }

  logAudit(db, {
    entityType: 'user',
    entityId: targetId,
    entityName: nextUsername,
    action: 'update',
    changedBy: actor.username,
    oldData: { username: oldRow.username, display_name: oldRow.display_name, role: oldRow.role, team_id: oldRow.team_id, is_active: oldRow.is_active },
    newData: { username: nextUsername, display_name: displayName, role: safeRole, team_id: rawTeamId, is_active: nextIsActive },
  });

  return NextResponse.json({ ok: true });
});

export const DELETE = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertAdmin(actor);

  const targetId = pathId((await params).id);
  const db = getDb();

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) as UserRow | undefined;
  if (!user) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
  }

  // 본인 계정은 삭제 불가(현재 세션이 즉시 파괴되는 사고 방지).
  if (actor.userId === targetId) {
    return NextResponse.json({ error: '현재 로그인한 본인 계정은 삭제할 수 없습니다.' }, { status: 400 });
  }

  // 잠금 방지: 마지막 활성 관리자는 삭제 불가.
  if (wouldRemoveLastAdmin(activeAdminIds(db), targetId, false)) {
    return NextResponse.json({ error: '마지막 관리자 계정은 삭제할 수 없습니다.' }, { status: 400 });
  }

  // 하드 삭제. audit_logs/access_logs 는 username 을 별도 보존하므로 이력은 남는다.
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

  logAudit(db, {
    entityType: 'user',
    entityId: targetId,
    entityName: user.username,
    action: 'delete',
    changedBy: actor.username,
    oldData: { username: user.username, display_name: user.display_name, role: user.role, team_id: user.team_id, is_active: user.is_active },
  });

  return NextResponse.json({ ok: true });
});

import { getDb } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertAdmin } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { asBody, str, pathId, ValidationError } from '@/lib/validation/input';
import type { TeamRow, CountRow } from '@/lib/db-types';

type Ctx = { params: Promise<{ id: string }> };

// 팀(부서) 개별 관리 — 총괄(admin) 전용
export const PUT = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertAdmin(actor);

  const teamId = pathId((await params).id);
  const b = asBody(await readJson(req));
  const name = str(b, 'team_name', { required: true, max: 100, label: '팀 이름' });

  const db = getDb();
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as TeamRow | undefined;
  if (!team) {
    return NextResponse.json({ error: '팀을 찾을 수 없습니다.' }, { status: 404 });
  }
  const dup = db.prepare('SELECT id FROM teams WHERE team_name = ? AND id != ?').get(name, teamId);
  if (dup) throw new ValidationError('이미 존재하는 팀 이름입니다.');

  db.prepare('UPDATE teams SET team_name = ? WHERE id = ?').run(name, teamId);

  logAudit(db, {
    entityType: 'team',
    entityId: teamId,
    entityName: name,
    action: 'update',
    changedBy: actor.username,
    oldData: { team_name: team.team_name },
    newData: { team_name: name },
  });

  return NextResponse.json({ ok: true });
});

export const DELETE = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertAdmin(actor);

  const teamId = pathId((await params).id);
  const db = getDb();
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as TeamRow | undefined;
  if (!team) {
    return NextResponse.json({ error: '팀을 찾을 수 없습니다.' }, { status: 404 });
  }

  // 소속 사용자/자산이 있으면 삭제 차단(409) — 먼저 재배정(미배정 큐) 후 삭제해야 감사 추적이 명확하다.
  const userCount = (db.prepare('SELECT COUNT(*) AS c FROM users WHERE team_id = ?').get(teamId) as CountRow).c;
  const assetCount = (db.prepare('SELECT COUNT(*) AS c FROM assets WHERE team_id = ?').get(teamId) as CountRow).c;
  if (userCount > 0 || assetCount > 0) {
    return NextResponse.json(
      { error: `소속 사용자 ${userCount}명 · 자산 ${assetCount}건이 있어 삭제할 수 없습니다. 먼저 재배정하세요.` },
      { status: 409 },
    );
  }

  db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);

  logAudit(db, {
    entityType: 'team',
    entityId: teamId,
    entityName: team.team_name,
    action: 'delete',
    changedBy: actor.username,
    oldData: { team_name: team.team_name },
  });

  return NextResponse.json({ ok: true });
});

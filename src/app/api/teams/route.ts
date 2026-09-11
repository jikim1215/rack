import { getDb } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertAdmin } from '@/lib/authz';
import { logAudit } from '@/lib/audit';
import { asBody, str, ValidationError } from '@/lib/validation/input';
import type { TeamRow } from '@/lib/db-types';

// 팀(부서) 관리 API — 총괄(admin) 전용 (ADR-009: team_id가 자산 소유권의 권위)
export const GET = withApi(async () => {
  const actor = await getActor();
  assertAdmin(actor);

  const db = getDb();
  const teams = db.prepare(`
    SELECT
      t.id,
      t.team_name,
      t.created_at,
      (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id) AS user_count,
      (SELECT COUNT(*) FROM assets a WHERE a.team_id = t.id) AS asset_count
    FROM teams t
    ORDER BY t.team_name
  `).all() as (TeamRow & { user_count: number; asset_count: number })[];
  return NextResponse.json(teams);
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertAdmin(actor);

  const b = asBody(await readJson(req));
  const name = str(b, 'team_name', { required: true, max: 100, label: '팀 이름' });

  const db = getDb();
  const existing = db.prepare('SELECT id FROM teams WHERE team_name = ?').get(name);
  if (existing) throw new ValidationError('이미 존재하는 팀 이름입니다.');

  const result = db.prepare('INSERT INTO teams (team_name) VALUES (?)').run(name);
  const id = Number(result.lastInsertRowid);

  logAudit(db, {
    entityType: 'team',
    entityId: id,
    entityName: name,
    action: 'create',
    changedBy: actor.username,
    newData: { team_name: name },
  });

  return NextResponse.json({ id }, { status: 201 });
});

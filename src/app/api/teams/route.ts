import { getDb } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getActor, authzError } from '@/lib/api-authz';
import { assertAdmin } from '@/lib/authz';

// 팀(부서) 관리 API — 총괄(admin) 전용 (ADR-009: team_id가 자산 소유권의 권위)
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
  const teams = db.prepare(`
    SELECT
      t.id,
      t.team_name,
      t.created_at,
      (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id) AS user_count,
      (SELECT COUNT(*) FROM assets a WHERE a.team_id = t.id) AS asset_count
    FROM teams t
    ORDER BY t.team_name
  `).all();
  return NextResponse.json(teams);
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

  const { team_name } = await req.json();
  const name = typeof team_name === 'string' ? team_name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: '팀 이름은 필수입니다.' }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM teams WHERE team_name = ?').get(name);
  if (existing) {
    return NextResponse.json({ error: '이미 존재하는 팀 이름입니다.' }, { status: 400 });
  }

  const result = db.prepare('INSERT INTO teams (team_name) VALUES (?)').run(name);
  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 });
}

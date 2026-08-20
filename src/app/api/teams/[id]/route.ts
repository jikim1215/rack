import { getDb } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getActor, authzError } from '@/lib/api-authz';
import { assertAdmin } from '@/lib/authz';

// 팀(부서) 개별 관리 — 총괄(admin) 전용
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
  const teamId = Number(id);
  const { team_name } = await req.json();
  const name = typeof team_name === 'string' ? team_name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: '팀 이름은 필수입니다.' }, { status: 400 });
  }

  const db = getDb();
  const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
  if (!team) {
    return NextResponse.json({ error: '팀을 찾을 수 없습니다.' }, { status: 404 });
  }
  const dup = db.prepare('SELECT id FROM teams WHERE team_name = ? AND id != ?').get(name, teamId);
  if (dup) {
    return NextResponse.json({ error: '이미 존재하는 팀 이름입니다.' }, { status: 400 });
  }

  db.prepare('UPDATE teams SET team_name = ? WHERE id = ?').run(name, teamId);
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
  const teamId = Number(id);
  const db = getDb();
  const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
  if (!team) {
    return NextResponse.json({ error: '팀을 찾을 수 없습니다.' }, { status: 404 });
  }

  // 소속 사용자/자산이 있으면 삭제 차단(409) — 먼저 재배정(미배정 큐) 후 삭제해야 감사 추적이 명확하다.
  const userCount = (db.prepare('SELECT COUNT(*) AS c FROM users WHERE team_id = ?').get(teamId) as { c: number }).c;
  const assetCount = (db.prepare('SELECT COUNT(*) AS c FROM assets WHERE team_id = ?').get(teamId) as { c: number }).c;
  if (userCount > 0 || assetCount > 0) {
    return NextResponse.json(
      { error: `소속 사용자 ${userCount}명 · 자산 ${assetCount}건이 있어 삭제할 수 없습니다. 먼저 재배정하세요.` },
      { status: 409 },
    );
  }

  db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
  return NextResponse.json({ ok: true });
}

import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { getActor, withApi } from '@/lib/api-authz';
import { assertAdmin } from '@/lib/authz';
import { findInactiveUsers, deactivateInactiveUsers, inactiveCutoff, INACTIVE_MONTHS } from '@/lib/inactive-users';

// 장기 미사용 계정 점검 (총괄 전용). 매일 03:30 유지보수 타이머가 같은 처리를 자동으로 하고,
// 여기서는 총괄이 대상을 미리 보고(GET) 즉시 처리(POST)할 수 있다.
export const GET = withApi(async () => {
  const actor = await getActor();
  assertAdmin(actor);
  const db = getDb();
  return NextResponse.json({ months: INACTIVE_MONTHS, cutoff: inactiveCutoff(db), users: findInactiveUsers(db) });
});

export const POST = withApi(async () => {
  const actor = await getActor();
  assertAdmin(actor);
  const db = getDb();
  const done = deactivateInactiveUsers(db, actor.username);
  return NextResponse.json({ ok: true, deactivated: done.map((u) => u.username) });
});

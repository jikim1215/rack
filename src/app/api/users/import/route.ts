import { getDb } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getActor, withApi, readFormData } from '@/lib/api-authz';
import { assertAdmin } from '@/lib/authz';
import { hashPlaintextPasswordAsync } from '@/lib/auth';
import { readUploadSheet } from '@/lib/xlsx-upload';
import { validateUserRows, buildUserImportTemplate, type ImportUser } from '@/lib/user-import';
import { logAudit } from '@/lib/audit';
import { ValidationError } from '@/lib/validation/input';

// 사용자 계정 엑셀 일괄 등록 (총괄 전용). 규약은 src/lib/user-import.ts.
//   GET            : 등록 양식(.xlsx) — 작성안내 시트에 현재 팀 목록 포함
//   POST file      : 검증만(dryRun=1) 또는 등록. 한 행이라도 오류면 400 + 행별 오류, 아무것도 등록하지 않는다.

function loadContext(db: ReturnType<typeof getDb>) {
  return {
    existingUsernames: new Set((db.prepare('SELECT username FROM users').all() as { username: string }[]).map((r) => r.username.toLowerCase())),
    teams: db.prepare('SELECT id, team_name FROM teams ORDER BY team_name').all() as { id: number; team_name: string }[],
  };
}

export const GET = withApi(async () => {
  const actor = await getActor();
  assertAdmin(actor);
  const { teams } = loadContext(getDb());
  const buf = await buildUserImportTemplate(teams.map((t) => t.team_name));
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename=user-import-template.xlsx',
    },
  });
});

const preview = (users: ImportUser[]) =>
  users.map((u) => ({ row: u.row, username: u.username, display_name: u.display_name, role: u.role, team_name: u.team_name, allowed_ips: u.allowed_ips }));

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertAdmin(actor);

  const form = await readFormData(req);
  const dryRun = String(form.get('dryRun') || '') === '1';
  // 크기·매직바이트·압축 폭탄·파싱 실패 → 400 (lib/xlsx-upload.ts). 빈 행을 유지해야 오류의 행 번호가 엑셀과 맞는다.
  const rows = await readUploadSheet(form.get('file') as File | null);

  const db = getDb();
  const { users, errors } = validateUserRows(rows, loadContext(db));
  if (errors.length > 0) {
    return NextResponse.json({ error: `오류 ${errors.length}건 — 아무 계정도 등록하지 않았습니다.`, errors, valid: users.length }, { status: 400 });
  }
  if (dryRun) return NextResponse.json({ ok: true, dryRun: true, users: preview(users) });

  // 초기 비밀번호 = 이메일. scrypt 는 건당 수십 ms 라 비동기로(이벤트 루프를 막지 않게), libuv 스레드 수만큼씩 묶어 계산한다.
  const hashes: string[] = [];
  for (let i = 0; i < users.length; i += 4) {
    hashes.push(...(await Promise.all(users.slice(i, i + 4).map((u) => hashPlaintextPasswordAsync(u.username)))));
  }

  const insert = db.prepare(
    'INSERT INTO users (username, password_hash, display_name, role, team_id, allowed_ips, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 1)',
  );
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?');
  db.transaction(() => {
    users.forEach((u, i) => {
      // 검증~등록 사이(해시 계산 중) 다른 총괄이 같은 이메일을 만들었으면 전체 취소
      if (exists.get(u.username)) throw new ValidationError(`${u.row}행 '${u.username}' 이(가) 방금 다른 경로로 등록되었습니다. 다시 올리세요.`);
      const id = Number(insert.run(u.username, hashes[i], u.display_name, u.role, u.team_id, u.allowed_ips).lastInsertRowid);
      logAudit(db, {
        entityType: 'user',
        entityId: id,
        entityName: u.username,
        action: 'create',
        changedBy: actor.username,
        newData: { username: u.username, display_name: u.display_name, role: u.role, team_id: u.team_id, is_active: 1, must_change_password: 1, source: 'excel_import' },
      });
    });
  })();

  return NextResponse.json({ ok: true, inserted: users.length, users: preview(users) }, { status: 201 });
});

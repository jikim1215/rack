import { getDb } from '@/lib/db';
import { hashPlaintextPassword } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getActor, authzError } from '@/lib/api-authz';
import { assertAdmin } from '@/lib/authz';
import { loadMailRelayConfig, isEmailEnabled, sendEmail, absoluteUrl } from '@/lib/mailer';

// 관리자 비밀번호 초기화 (공존시스템 규약과 동일):
//   초기 비밀번호 = 사용자 이메일(로그인 ID) 그 자체 + must_change_password=1.
//   사용자는 자기 이메일을 알고 있으므로 전달할 비밀이 없다 → 메일에 비밀번호를 담지 않는다.
//   메일 릴레이가 설정되어 있으면 "초기화됨 + 로그인 후 변경 필요"를 통지(best-effort).
//   대상 계정의 기존 세션은 무효화(token_version+1)하고 로그인 잠금(login_attempts)도 해제한다.
export async function POST(
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

  const user = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(targetId) as
    | { id: number; username: string; display_name: string }
    | undefined;
  if (!user) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
  }

  // 초기 비밀번호 = 이메일(username). 강제변경 표시 + 기존 세션 무효화.
  db.prepare(
    'UPDATE users SET password_hash = ?, must_change_password = 1, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?'
  ).run(hashPlaintextPassword(user.username), targetId);
  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(`u:${user.username}`);

  // 초기화 통지 메일 (best-effort — 미설정/실패해도 초기화 자체는 성공).
  let emailed = false;
  const config = loadMailRelayConfig();
  if (isEmailEnabled(config)) {
    const loginUrl = absoluteUrl(config, '/login');
    const name = user.display_name || user.username;
    try {
      await sendEmail(config, {
        to: user.username,
        subject: '[자산관리] 비밀번호가 초기화되었습니다',
        text:
          `${name} 님,\n\n` +
          `관리자가 자산관리 시스템 계정의 비밀번호를 초기화했습니다.\n` +
          `초기화된 임시 비밀번호는 회원님의 이메일 주소(= 로그인 ID)와 동일합니다.\n\n` +
          `1) ${loginUrl ?? '로그인 페이지'} 에서 아이디·비밀번호 모두에 본인 이메일 주소를 입력해 로그인\n` +
          `2) 안내에 따라 새 비밀번호를 즉시 설정\n\n` +
          `본인이 요청하지 않았다면 관리자에게 문의하세요.`,
      });
      emailed = true;
    } catch {
      // 발송 실패는 무시(초기화는 이미 완료). 관리자는 UI 응답의 emailed=false 로 인지.
      emailed = false;
    }
  }

  return NextResponse.json({ ok: true, username: user.username, emailed });
}

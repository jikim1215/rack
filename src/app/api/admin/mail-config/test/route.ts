import { NextRequest, NextResponse } from 'next/server';
import { getActor, authzError } from '@/lib/api-authz';
import { assertAdmin } from '@/lib/authz';
import { loadMailRelayConfig, sendEmail } from '@/lib/mailer';
import { validateEmail } from '@/lib/user-admin';

// POST — 테스트 메일 발송 (admin). enabled/NOTIFICATION_CHANNELS 와 무관하게
//   DB 설정(host/from/baseUrl)만 완비되면 연결성 검증용으로 발송한다.
//   body { to? } 미지정 시 관리자 본인 이메일(로그인 ID)로.
export async function POST(req: NextRequest) {
  const actor = await getActor();
  try {
    assertAdmin(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  let to = actor!.username;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body.to === 'string' && body.to.trim()) to = body.to.trim();
  } catch { /* 본문 없음 허용 */ }

  const emailErr = validateEmail(to);
  if (emailErr) {
    return NextResponse.json({ error: `수신 주소: ${emailErr}` }, { status: 400 });
  }

  const config = loadMailRelayConfig();
  if (!config || !config.host || !config.fromAddress || !config.baseUrl) {
    return NextResponse.json({ error: 'SMTP 호스트·발신 주소·기준 URL을 먼저 저장하세요.' }, { status: 422 });
  }

  try {
    await sendEmail(config, {
      to,
      subject: '[자산관리] 메일 릴레이 테스트',
      text: '자산관리 시스템의 메일 릴레이 설정이 정상 동작합니다. 이 메일은 연결성 검증용입니다.',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `발송 실패: ${msg}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, to });
}

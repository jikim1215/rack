import { getDb } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getActor, authzError } from '@/lib/api-authz';
import { assertAdmin } from '@/lib/authz';
import { validateMailConfig, emailChannelActive } from '@/lib/mail-config';

// GET — 현재 메일 릴레이 설정 (admin). 미설정이면 기본값.
export async function GET() {
  const actor = await getActor();
  try {
    assertAdmin(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const row = getDb()
    .prepare('SELECT host, port, security, from_address, from_name, base_url, enabled, updated_at FROM mail_relay_config WHERE id = 1')
    .get() as
    | { host: string; port: number; security: string; from_address: string; from_name: string; base_url: string; enabled: number; updated_at: string }
    | undefined;

  return NextResponse.json({
    host: row?.host ?? '',
    port: row?.port ?? 25,
    security: row?.security ?? 'NONE',
    from_address: row?.from_address ?? '',
    from_name: row?.from_name ?? '',
    base_url: row?.base_url ?? '',
    enabled: !!row?.enabled,
    updated_at: row?.updated_at ?? null,
    // 운영 override로 이메일 채널이 강제 OFF면 화면에 경고하기 위한 힌트.
    channel_forced_off: !emailChannelActive(),
  });
}

// PUT — 메일 릴레이 설정 저장 (admin). 단일행 upsert.
export async function PUT(req: NextRequest) {
  const actor = await getActor();
  try {
    assertAdmin(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const parsed = validateMailConfig(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const c = parsed.value;

  getDb().prepare(
    `INSERT INTO mail_relay_config (id, host, port, security, from_address, from_name, base_url, enabled, updated_at)
     VALUES (1, @host, @port, @security, @fromAddress, @fromName, @baseUrl, @enabled, datetime('now','localtime'))
     ON CONFLICT(id) DO UPDATE SET
       host=excluded.host, port=excluded.port, security=excluded.security,
       from_address=excluded.from_address, from_name=excluded.from_name,
       base_url=excluded.base_url, enabled=excluded.enabled, updated_at=excluded.updated_at`
  ).run({
    host: c.host,
    port: c.port,
    security: c.security,
    fromAddress: c.fromAddress,
    fromName: c.fromName,
    baseUrl: c.baseUrl,
    enabled: c.enabled ? 1 : 0,
  });

  return NextResponse.json({ ok: true });
}

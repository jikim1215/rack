import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertCanRead, AuthzError } from "@/lib/authz";
import { getSession, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  generateSecret, verifyTotp, otpauthUri, formatSecretForDisplay, generateBackupCodes,
} from "@/lib/totp";
import { encodeQr, qrSvgPath } from "@/lib/qr";
import { asBody, str, ValidationError } from "@/lib/validation/input";
import type { UserRow } from "@/lib/db-types";

// ── 2단계 인증 등록/해제 (본인 계정) ──
// GET    : 현재 상태 조회 (활성 여부, 남은 백업 코드 수)
// POST   : 시크릿 발급 — 아직 활성화하지 않는다(코드 확인 전까지 totp_enabled=0). 재호출하면 새 시크릿으로 교체.
// PUT    : 코드 확인 → 활성화 + 백업 코드 10개 발급(이때 한 번만 평문 반환)
// DELETE : 해제 — 현재 코드(또는 백업 코드)를 요구해 타인이 세션만 탈취해 끄지 못하게 한다.
//
// 잠금 방지: 관리자가 타인의 MFA 를 끄는 건 /api/users/[id]/mfa (총괄 전용). 여기서는 본인 것만.

export const GET = withApi(async () => {
  const actor = await getActor();
  assertCanRead(actor);
  const db = getDb();
  const u = db.prepare("SELECT totp_enabled, totp_secret, backup_codes FROM users WHERE id = ?").get(actor.userId) as
    | Pick<UserRow, "totp_enabled" | "totp_secret" | "backup_codes">
    | undefined;
  let left = 0;
  try { const a = JSON.parse(u?.backup_codes || "[]"); left = Array.isArray(a) ? a.length : 0; } catch { left = 0; }
  return NextResponse.json({
    enabled: !!u?.totp_enabled,
    pendingSetup: !u?.totp_enabled && !!u?.totp_secret,
    backupCodesLeft: left,
  });
});

export const POST = withApi(async () => {
  const actor = await getActor();
  assertCanRead(actor);
  const db = getDb();
  const u = db.prepare("SELECT totp_enabled FROM users WHERE id = ?").get(actor.userId) as Pick<UserRow, "totp_enabled"> | undefined;
  if (u?.totp_enabled) throw new ValidationError("이미 2단계 인증이 켜져 있습니다. 다시 설정하려면 먼저 해제하세요.");

  const secret = generateSecret();
  // 활성화는 PUT(코드 확인) 에서. 여기서는 시크릿만 심어둔다 — 확인 못 하면 켜지지 않는다.
  db.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_last_counter = 0 WHERE id = ?").run(secret, actor.userId);
  const uri = otpauthUri(secret, actor.username);
  // QR 은 서버에서 행렬로 만들어 SVG path 로 내린다 — 클라이언트는 <path d> 만 그린다(외부 라이브러리·이미지 불필요).
  const qr = qrSvgPath(encodeQr(uri, "M"));
  return NextResponse.json({
    secret,
    secretDisplay: formatSecretForDisplay(secret),
    otpauthUri: uri,
    qr,
    digits: 6,
    periodSec: 30,
  });
});

export const PUT = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertCanRead(actor);
  const db = getDb();
  const b = asBody(await readJson(req));
  const code = str(b, "code", { required: true, max: 20, label: "인증 코드" });

  const u = db.prepare("SELECT totp_secret, totp_enabled FROM users WHERE id = ?").get(actor.userId) as
    | Pick<UserRow, "totp_secret" | "totp_enabled">
    | undefined;
  if (!u?.totp_secret) throw new ValidationError("먼저 시크릿을 발급받으세요.");
  if (u.totp_enabled) throw new ValidationError("이미 2단계 인증이 켜져 있습니다.");

  const r = verifyTotp(u.totp_secret, code);
  if (!r.ok) {
    throw new ValidationError(
      r.reason === "format" ? "6자리 숫자를 입력하세요." : "코드가 일치하지 않습니다. 휴대폰 시간이 정확한지 확인하세요.",
    );
  }

  const { plain, hashed } = generateBackupCodes();
  db.prepare("UPDATE users SET totp_enabled = 1, totp_last_counter = ?, backup_codes = ? WHERE id = ?")
    .run(r.counter, JSON.stringify(hashed), actor.userId);
  logAudit(db, {
    entityType: "user", entityId: actor.userId, entityName: actor.username,
    action: "update", changedBy: actor.username,
    oldData: { totp_enabled: 0 }, newData: { totp_enabled: 1 },
  });

  // 백업 코드 평문은 이 응답에서만 나간다. DB 에는 해시만 남는다.
  const res = NextResponse.json({ ok: true, backupCodes: plain });
  // 등록 강제(msr) 상태였다면 세션을 재발급해 미들웨어 차단을 즉시 풀어준다(재로그인 불필요).
  const session = await getSession();
  if (session?.msr) {
    const token = createSessionToken({
      userId: session.userId, username: session.username, displayName: session.displayName,
      role: session.role, teamId: session.teamId ?? null, tv: session.tv ?? 0, mcp: !!session.mcp,
    });
    const opts = sessionCookieOptions();
    res.cookies.set(opts.name, token, { httpOnly: opts.httpOnly, secure: opts.secure, sameSite: opts.sameSite, path: opts.path, maxAge: opts.maxAge });
  }
  return res;
});

export const DELETE = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertCanRead(actor);
  const db = getDb();
  const b = asBody(await readJson(req).catch(() => ({})));
  const code = str(b, "code", { max: 20, label: "인증 코드" });

  const u = db.prepare("SELECT totp_secret, totp_enabled, totp_last_counter FROM users WHERE id = ?").get(actor.userId) as
    | Pick<UserRow, "totp_secret" | "totp_enabled" | "totp_last_counter">
    | undefined;
  if (!u?.totp_enabled) {
    // 미완료 등록(시크릿만 있는 상태)은 코드 없이 정리 가능
    db.prepare("UPDATE users SET totp_secret = '', totp_enabled = 0, totp_last_counter = 0, backup_codes = '[]' WHERE id = ?").run(actor.userId);
    return NextResponse.json({ ok: true });
  }
  // 활성 상태 해제는 현재 코드를 요구한다 — 세션만 탈취한 공격자가 2차 요소를 떼어내지 못하게.
  const r = verifyTotp(u.totp_secret, code, { lastCounter: u.totp_last_counter ?? 0 });
  if (!r.ok) throw new AuthzError("해제하려면 현재 인증 코드를 입력해야 합니다.");

  db.prepare("UPDATE users SET totp_secret = '', totp_enabled = 0, totp_last_counter = 0, backup_codes = '[]' WHERE id = ?").run(actor.userId);
  logAudit(db, {
    entityType: "user", entityId: actor.userId, entityName: actor.username,
    action: "update", changedBy: actor.username,
    oldData: { totp_enabled: 1 }, newData: { totp_enabled: 0 },
  });
  return NextResponse.json({ ok: true });
});

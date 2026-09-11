import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { withApi, readJson } from "@/lib/api-authz";
import { createSessionToken, sessionCookieOptions, verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { verifyTotp, findBackupCode } from "@/lib/totp";
import { logAccess, clientMeta } from "@/lib/access-log";
import { asBody, str } from "@/lib/validation/input";
import type { UserRow } from "@/lib/db-types";

// ── 2단계 인증 코드 교환 ──
// 로그인 1차(비밀번호) 통과 시 발급된 대기 토큰(pur='mfa')을 받아, 인증 앱 코드 또는 백업 코드를
// 검증하고 정식 세션으로 교체한다. 대기 토큰 자체로는 어떤 화면·API 도 접근할 수 없다(getSession 거부).
//
// 무차별 대입 방어: 6자리 = 100만 조합이므로 시도 제한이 필수다. login_attempts 를 'm:<username>' 키로
// 재사용해 5회 실패 시 15분 잠금(로그인과 동일 정책). 잠금은 비밀번호 단계와 분리된 키라 서로 간섭하지 않는다.
const MAX_MFA_ATTEMPTS = 5;
const MFA_LOCKOUT_MS = 15 * 60 * 1000;

export const POST = withApi(async (req: NextRequest) => {
  const { ip, userAgent } = clientMeta(req);
  const db = getDb();

  const pendingToken = req.cookies.get(SESSION_COOKIE)?.value;
  const pending = pendingToken ? verifySessionToken(pendingToken) : null;
  if (!pending || pending.pur !== "mfa") {
    return NextResponse.json({ error: "인증 대기 상태가 아닙니다. 처음부터 다시 로그인하세요." }, { status: 401 });
  }

  const b = asBody(await readJson(req));
  const code = str(b, "code", { required: true, max: 20, label: "인증 코드" });

  const attemptKey = `m:${pending.username}`;
  const now = Date.now();
  const att = db.prepare("SELECT fail_count, first_fail_at, locked_until FROM login_attempts WHERE key = ?").get(attemptKey) as
    | { fail_count: number; first_fail_at: number; locked_until: number }
    | undefined;
  if (att && att.locked_until > now) {
    logAccess(db, { userId: pending.userId, username: pending.username, ip, userAgent, action: "fail", resultCode: "429", failureReason: "mfa_rate_limited" });
    return NextResponse.json(
      { error: `인증 시도 횟수를 초과했습니다. ${Math.ceil((att.locked_until - now) / 1000)}초 후 재시도하세요.` },
      { status: 429 },
    );
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ? AND is_active = 1").get(pending.userId) as UserRow | undefined;
  if (!user || !user.totp_enabled) {
    return NextResponse.json({ error: "인증 대기 상태가 아닙니다. 처음부터 다시 로그인하세요." }, { status: 401 });
  }
  // 대기 토큰 발급 이후 비밀번호 변경·강제 로그아웃이 있었으면 무효
  if ((pending.tv ?? 0) !== (user.token_version ?? 0)) {
    return NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인하세요." }, { status: 401 });
  }

  // 1) 인증 앱 코드 → 2) 백업 코드 순으로 검증
  let method: "totp" | "backup" | null = null;
  const totpResult = verifyTotp(user.totp_secret, code, { lastCounter: user.totp_last_counter ?? 0 });
  if (totpResult.ok) {
    // 재사용 차단: 성공한 counter 를 기록 (같은 30초 창의 코드 재제출 거부)
    db.prepare("UPDATE users SET totp_last_counter = ? WHERE id = ?").run(totpResult.counter, user.id);
    method = "totp";
  } else {
    let hashes: string[] = [];
    try { hashes = JSON.parse(user.backup_codes || "[]"); } catch { hashes = []; }
    const idx = Array.isArray(hashes) ? findBackupCode(code, hashes) : -1;
    if (idx >= 0) {
      // 1회용: 사용한 코드를 목록에서 제거
      hashes.splice(idx, 1);
      db.prepare("UPDATE users SET backup_codes = ? WHERE id = ?").run(JSON.stringify(hashes), user.id);
      method = "backup";
    }
  }

  if (!method) {
    const row = db.prepare(
      `INSERT INTO login_attempts (key, fail_count, first_fail_at, locked_until) VALUES (@key, 1, @now, 0)
       ON CONFLICT(key) DO UPDATE SET
         fail_count = CASE WHEN @now - first_fail_at > @window THEN 1 ELSE fail_count + 1 END,
         first_fail_at = CASE WHEN @now - first_fail_at > @window THEN @now ELSE first_fail_at END
       RETURNING fail_count`,
    ).get({ key: attemptKey, now, window: MFA_LOCKOUT_MS }) as { fail_count: number };
    if (row.fail_count >= MAX_MFA_ATTEMPTS) {
      db.prepare("UPDATE login_attempts SET locked_until = ? WHERE key = ?").run(now + MFA_LOCKOUT_MS, attemptKey);
    }
    const reason = totpResult.reason === "replay" ? "이미 사용한 코드입니다. 다음 코드가 나올 때까지 기다리세요." : "인증 코드가 올바르지 않습니다.";
    logAccess(db, { userId: user.id, username: user.username, ip, userAgent, action: "fail", resultCode: "401", failureReason: `mfa_${totpResult.reason ?? "invalid"}` });
    return NextResponse.json(
      { error: `${reason} (남은 시도: ${Math.max(0, MAX_MFA_ATTEMPTS - row.fail_count)}회)` },
      { status: 401 },
    );
  }

  // 성공 → 로그인/MFA 시도 카운터 모두 초기화, 정식 세션 발급
  for (const k of [attemptKey, `u:${user.username}`, `ip:${ip}`]) {
    db.prepare("DELETE FROM login_attempts WHERE key = ?").run(k);
  }
  const remainingBackup = (() => {
    try {
      const row = db.prepare("SELECT backup_codes FROM users WHERE id = ?").get(user.id) as Pick<UserRow, "backup_codes">;
      const arr = JSON.parse(row?.backup_codes || "[]");
      return Array.isArray(arr) ? arr.length : 0;
    } catch { return 0; }
  })();
  logAccess(db, { userId: user.id, username: user.username, ip, userAgent, action: "login", resultCode: "200", failureReason: `mfa_${method}` });

  const token = createSessionToken({
    userId: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    teamId: user.team_id ?? null,
    tv: user.token_version ?? 0,
    mcp: !!user.must_change_password,
  });
  const res = NextResponse.json({
    ok: true,
    method,
    // 백업 코드로 들어왔으면 남은 개수를 알려 재발급을 유도한다
    ...(method === "backup" ? { backupCodesLeft: remainingBackup } : {}),
    user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
  });
  const opts = sessionCookieOptions();
  res.cookies.set(opts.name, token, {
    httpOnly: opts.httpOnly,
    secure: opts.secure,
    sameSite: opts.sameSite,
    path: opts.path,
    maxAge: opts.maxAge,
  });
  return res;
});

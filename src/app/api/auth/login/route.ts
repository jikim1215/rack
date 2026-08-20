import { getDb } from "@/lib/db";
import { verifyPassword, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { logAccess, clientMeta } from "@/lib/access-log";
import { isIpAllowed } from "@/lib/ip-access";
import type Database from "better-sqlite3";

// 로그인 시도 제한 (brute-force 방어) — login_attempts 테이블 기반 (재시작·멀티프로세스 내성).
// 키 2개 동시 운영: "u:<username>" / "ip:<ip>" — 둘 중 하나라도 잠금이면 거부, 성공 시 둘 다 삭제.
// IP 키는 TRUST_PROXY=true가 아니면 항상 "ip:direct"로 수렴 — 위조 XFF로 타인 잠금·자기 우회 불가.
// 단, "ip:direct" 수렴 상태에서 IP 임계치가 계정 임계치와 같으면 한 계정 공격이 전 사용자 로그인을
// 잠그는 전역 DoS가 된다 → IP 식별 불가(direct) 시 IP 키 임계치를 4배로 "완화"(제거 아님 — 다계정
// 스프레이 감속 브레이크). 완전한 구분이 필요하면 프록시 뒤 배포 + TRUST_PROXY=true 권장(DEPLOY.md).
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15분
function maxAttemptsFor(key: string): number {
  return key === "ip:direct" ? MAX_ATTEMPTS * 4 : MAX_ATTEMPTS;
}

interface AttemptRow {
  fail_count: number;
  first_fail_at: number;
  locked_until: number;
}

function checkRateLimit(
  db: Database.Database,
  key: string,
): { allowed: boolean; remaining: number; retryAfter?: number } {
  const now = Date.now();
  const row = db
    .prepare("SELECT fail_count, first_fail_at, locked_until FROM login_attempts WHERE key = ?")
    .get(key) as AttemptRow | undefined;

  if (!row) return { allowed: true, remaining: maxAttemptsFor(key) };

  // 잠금 중이면 거부 (잠금이 윈도우보다 우선)
  if (row.locked_until > now) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((row.locked_until - now) / 1000) };
  }

  // 오래된 행 정리: 최초 실패 후 15분 경과 시 리셋
  if (now - row.first_fail_at > LOCKOUT_DURATION) {
    db.prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
    return { allowed: true, remaining: maxAttemptsFor(key) };
  }

  return { allowed: true, remaining: Math.max(0, maxAttemptsFor(key) - row.fail_count) };
}

/** 실패 1회 기록 — 원자 UPSERT (확인·증가 분리 레이스 제거, 멀티프로세스 전환 대비. 비평 합의 R4-1). */
function recordFailedAttempt(db: Database.Database, key: string): number {
  const now = Date.now();
  const row = db.prepare(
    `INSERT INTO login_attempts (key, fail_count, first_fail_at, locked_until) VALUES (@key, 1, @now, 0)
     ON CONFLICT(key) DO UPDATE SET
       fail_count = CASE WHEN @now - first_fail_at > @window THEN 1 ELSE fail_count + 1 END,
       first_fail_at = CASE WHEN @now - first_fail_at > @window THEN @now ELSE first_fail_at END
     RETURNING fail_count`,
  ).get({ key, now, window: LOCKOUT_DURATION }) as { fail_count: number };
  if (row.fail_count >= maxAttemptsFor(key)) {
    // 잠금 설정은 반환된 카운트 기준이라 경쟁해도 동일 값으로 수렴(멱등)
    db.prepare("UPDATE login_attempts SET locked_until = ? WHERE key = ?").run(now + LOCKOUT_DURATION, key);
  }
  return row.fail_count;
}

function resetAttempts(db: Database.Database, ...keys: string[]) {
  const del = db.prepare("DELETE FROM login_attempts WHERE key = ?");
  for (const key of keys) del.run(key);
}

export async function POST(req: NextRequest) {
  const { ip, userAgent } = clientMeta(req); // TRUST_PROXY=true가 아니면 ip = "direct"
  const db = getDb();
  const ipKey = `ip:${ip}`;

  // IP 키 잠금 확인 (본문 파싱 전 — 잠긴 IP는 즉시 차단)
  const ipCheck = checkRateLimit(db, ipKey);
  if (!ipCheck.allowed) {
    logAccess(db, { username: "", ip, userAgent, action: "fail", resultCode: "429", failureReason: "rate_limited" });
    return NextResponse.json(
      { error: `로그인 시도 횟수를 초과했습니다. ${ipCheck.retryAfter}초 후 재시도하세요.` },
      { status: 429 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { username, password } = body;
  if (!username || !password || typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "아이디와 비밀번호를 입력하세요." }, { status: 400 });
  }

  // 입력값 길이 제한 (DoS 방지)
  if (username.length > 254 || password.length > 256) {
    return NextResponse.json({ error: "입력값이 너무 깁니다." }, { status: 400 });
  }

  // 사용자명 키 잠금 확인 (분산 IP로 특정 계정을 노리는 공격 차단)
  const userKey = `u:${username}`;
  const userCheck = checkRateLimit(db, userKey);
  if (!userCheck.allowed) {
    logAccess(db, { username: String(username), ip, userAgent, action: "fail", resultCode: "429", failureReason: "rate_limited" });
    return NextResponse.json(
      { error: `로그인 시도 횟수를 초과했습니다. ${userCheck.retryAfter}초 후 재시도하세요.` },
      { status: 429 }
    );
  }

  // 초기 설정 가드: 등록된 사용자가 0명이면(빈/미시드 DB 또는 잘못된 DB 경로) 구별되는 메시지로 안내.
  // 시스템 전역 상태이므로 사용자 열거 위험 없음. 잠금 카운트에도 포함하지 않는다(설정 오류이지 무차별 대입 아님).
  const userCount = (db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
  if (userCount === 0) {
    logAccess(db, { username: String(username ?? ""), ip, userAgent, action: "fail", resultCode: "503", failureReason: "no_users" });
    return NextResponse.json(
      { error: "등록된 사용자가 없습니다. 서버가 비어 있는 데이터베이스를 사용 중입니다 — 관리자에게 초기 데이터(예: npm run db:seed 또는 데이터 이관) 실행을 요청하세요." },
      { status: 503 }
    );
  }
  const user = db.prepare("SELECT * FROM users WHERE username = ? AND is_active = 1").get(username) as any;

  // 고의적으로 동일한 에러 메시지 사용 (사용자 열거 방지)
  if (!user || !verifyPassword(password, user.password_hash)) {
    // 두 키 모두 실패 기록 — 남은 횟수는 각 키의 임계(직결 IP는 4배 완화)를 반영해 더 먼저 잠기는 쪽 기준 (외부 검토 R6-1)
    const userFails = recordFailedAttempt(db, userKey);
    const ipFails = recordFailedAttempt(db, ipKey);
    logAccess(db, { userId: user?.id ?? null, username: String(username), ip, userAgent, action: "fail", resultCode: "401", failureReason: "invalid_credentials" });
    const remaining = Math.min(maxAttemptsFor(userKey) - userFails, maxAttemptsFor(ipKey) - ipFails);
    return NextResponse.json(
      { error: `아이디 또는 비밀번호가 일치하지 않습니다. (남은 시도: ${Math.max(0, remaining)}회)` },
      { status: 401 }
    );
  }

  // 사용자별 IP 접근제어 — 비번은 맞아도 허용 IP 밖이면 로그인 거부(관리자 페이지에서 설정).
  //   users.allowed_ips 가 비어있으면 제한 없음. 있으면 화이트리스트.
  //   IP 는 clientMeta(TRUST_PROXY=true 필요)에서 옴 — 프록시 뒤가 아니면 "direct"라 제한 사용자는 거부됨.
  const ipRule = isIpAllowed(ip, user.allowed_ips);
  if (!ipRule.allowed) {
    logAccess(db, { userId: user.id, username: user.username, ip, userAgent, action: "fail", resultCode: "403", failureReason: "ip_not_allowed" });
    return NextResponse.json(
      { error: "허용되지 않은 접속 위치(IP)입니다. 관리자에게 문의하세요." },
      { status: 403 }
    );
  }

  // 로그인 성공 → 두 키 모두 시도 횟수 초기화
  resetAttempts(db, userKey, ipKey);
  logAccess(db, { userId: user.id, username: user.username, ip, userAgent, action: "login", resultCode: "200" });

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
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    },
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
}

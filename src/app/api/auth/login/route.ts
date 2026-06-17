import { getDb } from "@/lib/db";
import { verifyPassword, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// 로그인 시도 제한 (brute-force 방어)
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15분

function getClientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") || "unknown";
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; retryAfter?: number } {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record) return { allowed: true, remaining: MAX_ATTEMPTS };

  // 잠금 시간 경과 시 초기화
  if (now - record.lastAttempt > LOCKOUT_DURATION) {
    loginAttempts.delete(ip);
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }

  if (record.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((LOCKOUT_DURATION - (now - record.lastAttempt)) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  return { allowed: true, remaining: MAX_ATTEMPTS - record.count };
}

function recordFailedAttempt(ip: string) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (record) {
    record.count++;
    record.lastAttempt = now;
  } else {
    loginAttempts.set(ip, { count: 1, lastAttempt: now });
  }
}

function resetAttempts(ip: string) {
  loginAttempts.delete(ip);
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rateCheck = checkRateLimit(ip);

  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: `로그인 시도 횟수를 초과했습니다. ${rateCheck.retryAfter}초 후 재시도하세요.` },
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
  if (username.length > 50 || password.length > 256) {
    return NextResponse.json({ error: "입력값이 너무 깁니다." }, { status: 400 });
  }

  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE username = ? AND is_active = 1").get(username) as any;

  // 고의적으로 동일한 에러 메시지 사용 (사용자 열거 방지)
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFailedAttempt(ip);
    const remaining = MAX_ATTEMPTS - (loginAttempts.get(ip)?.count || 0);
    return NextResponse.json(
      { error: `아이디 또는 비밀번호가 일치하지 않습니다. (남은 시도: ${Math.max(0, remaining)}회)` },
      { status: 401 }
    );
  }

  // 로그인 성공 → 시도 횟수 초기화
  resetAttempts(ip);

  const token = createSessionToken({
    userId: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
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

import { NextRequest, NextResponse } from "next/server";
import { sessionCookieOptions, getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { logAccess, clientMeta } from "@/lib/access-log";

export async function POST(req: NextRequest) {
  // 로그아웃 접속기록(AC-19): 현재 세션 주체 기록 후 쿠키 만료
  const session = await getSession();
  if (session) {
    const { ip, userAgent } = clientMeta(req);
    try {
      logAccess(getDb(), {
        userId: session.userId,
        username: session.username,
        ip,
        userAgent,
        action: "logout",
        resultCode: "200",
      });
    } catch { /* best-effort; 로그아웃 자체는 항상 성공 */ }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieOptions().name, "", { path: "/", maxAge: 0 });
  return res;
}

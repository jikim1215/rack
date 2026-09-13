import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi } from "@/lib/api-authz";
import { assertCanRead } from "@/lib/authz";
import { getSession, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { logAccess, clientMeta } from "@/lib/access-log";

// ── 취약 비밀번호 자진 신고 → 강제 변경 ──
// 로그인은 평문을 sha512 로 프리해시해 보내므로 서버는 정책(2종 이상 등)을 로그인 시점에 판별할 수 없다.
// 정책 도입 이전 비밀번호로 로그인한 브라우저가 스스로 이 API 를 불러 must_change_password 를 켠다.
//   - 본인 계정만, 더 엄격해지는 방향만(해제는 불가) → 악용 가치 없음.
//   - 세션을 mcp=true 로 즉시 재발급해 미들웨어가 /change-password 외 경로를 바로 막는다(다음 로그인까지 기다리지 않음).
export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertCanRead(actor);
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const { ip, userAgent } = clientMeta(req);

  db.prepare("UPDATE users SET must_change_password = 1 WHERE id = ?").run(actor.userId);
  logAccess(db, { userId: actor.userId, username: actor.username, ip, userAgent, action: "login", resultCode: "200", failureReason: "weak_password_flagged" });

  const token = createSessionToken({
    userId: session.userId, username: session.username, displayName: session.displayName,
    role: session.role, teamId: session.teamId ?? null, tv: session.tv ?? 0,
    mcp: true, ...(session.msr ? { msr: true } : {}),
  });
  const res = NextResponse.json({ ok: true, mustChangePassword: true });
  const opts = sessionCookieOptions();
  res.cookies.set(opts.name, token, { httpOnly: opts.httpOnly, secure: opts.secure, sameSite: opts.sameSite, path: opts.path, maxAge: opts.maxAge });
  return res;
});

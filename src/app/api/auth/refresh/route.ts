import { getSession, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { NextResponse } from "next/server";

// ── 세션 연장 (외부 검토 가격심의 갭 3 대응) ──
// 활동 중인 사용자가 만료 임박 배너에서 명시적으로 연장한다.
// getSession이 이미 매요청 DB 대조(is_active/token_version/role)를 수행하므로,
// 여기서 재발급되는 토큰은 항상 현재 권한 상태를 반영한다 — 강등/비활성화된 계정은 연장 불가.
// 유휴 세션은 연장 없이 TTL 만료 → 사실상의 유휴 타임아웃으로 동작한다.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "세션이 유효하지 않습니다. 다시 로그인하세요." }, { status: 401 });
  }

  const token = createSessionToken({
    userId: session.userId,
    username: session.username,
    displayName: session.displayName,
    role: session.role,
    teamId: session.teamId ?? null,
    tv: session.tv ?? 0,
  });

  // 새 exp를 응답에 포함 — 배너가 즉시 갱신할 수 있게
  const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
  const res = NextResponse.json({ ok: true, exp: payload.exp });
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

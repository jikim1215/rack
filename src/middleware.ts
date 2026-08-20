import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "asset_session";

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (
    !secret ||
    secret === "rack-asset-mgr-2024-secret-key" ||
    secret === "CHANGE-THIS-SECRET-IN-PRODUCTION"
  ) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[SECURITY] AUTH_SECRET 미설정/기본값: 운영 환경에서는 강력한 무작위 값을 설정해야 합니다."
      );
    }
    console.warn("[SECURITY] AUTH_SECRET 미설정/기본값 — 개발 모드 임시 키 사용 (운영 배포 금지).");
    return "dev-only-insecure-secret-do-not-use-in-production";
  }
  return secret;
}

async function decodeToken(token: string): Promise<{ role?: string; exp?: number; mcp?: boolean } | null> {
  try {
    const [json, sig] = token.split(".");
    if (!json || !sig) return null;

    // Edge Runtime: Web Crypto API — SHA-512
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(getSecret()),
      { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(json));
    const expected = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    if (sig !== expected) return null;
    const payload = JSON.parse(atob(json.replace(/-/g, "+").replace(/_/g, "/")));
    if (!(payload.exp > Date.now())) return null;
    return payload;
  } catch {
    return null;
  }
}

// 총괄(admin) 전용 API 접두사 (방어적 게이트 — 라우트 핸들러의 assertAdmin이 최종 권위)
const ADMIN_ONLY_API_PREFIXES = ["/api/users", "/api/teams", "/api/audit", "/api/access-logs", "/api/admin"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 인증 불필요 경로
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const payload = token ? await decodeToken(token) : null;
  if (!payload) {
    // API 요청은 401, 페이지 요청은 로그인 리다이렉트
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // nginx 프록시 뒤에서는 request.url/nextUrl 이 내부 바인딩(127.0.0.1:3000)을
    // 가리켜 절대 URL 이 localhost:3000 으로 새어나간다. 프록시가 넘긴
    // X-Forwarded-Host/Proto(없으면 Host)로 외부 오리진을 재구성해 유효한 절대 URL 을 만든다.
    const fwdHost =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      request.nextUrl.host;
    const fwdProto =
      request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
    const loginUrl = new URL(`${fwdProto}://${fwdHost}/login`);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 비밀번호 강제변경(관리자 초기화 등): /change-password 외 모든 경로 차단.
  //   /login·/api/auth·/_next 등은 상단 인증불필요 블록에서 이미 통과했다.
  if (payload.mcp && pathname !== "/change-password") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "PASSWORD_CHANGE_REQUIRED" }, { status: 403 });
    }
    const cpHost =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      request.nextUrl.host;
    const cpProto =
      request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
    return NextResponse.redirect(new URL(`${cpProto}://${cpHost}/change-password`));
  }

  // 역할 게이트: 총괄 전용 API 접두사는 admin만 (방어적; 핸들러 assertAdmin이 최종 권위)
  if (
    payload.role !== "admin" &&
    ADMIN_ONLY_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

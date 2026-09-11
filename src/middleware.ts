import { NextRequest, NextResponse } from "next/server";
import { ADMIN_ONLY_API_PREFIXES } from "@/lib/menus"; // 순수 모듈(Edge 안전) — 가드레일 테스트와 같은 배열

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

// ── CSP (nonce 기반, P4) ──
// 요청마다 nonce 를 만들어 script-src 를 'unsafe-inline' 없이 잠근다. Next 는 요청 헤더의 CSP nonce 를 읽어
// 자기 인라인 스크립트(하이드레이션)에 같은 nonce 를 붙이고, 'strict-dynamic' 으로 그 스크립트가 로드하는
// 청크를 허용한다. style-src 는 인라인 style 속성(그래프 막대 width 등) 때문에 'unsafe-inline' 유지.
// 폐쇄망 원칙: default-src 'self' 로 외부 출처 일체 차단. (next.config.ts 의 나머지 보안 헤더는 그대로)
const isDev = process.env.NODE_ENV !== "production";
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
  ].join("; ");
}

function forwardedOrigin(request: NextRequest): string {
  // nginx 프록시 뒤에서는 request.url/nextUrl 이 내부 바인딩(127.0.0.1:3000)을
  // 가리켜 절대 URL 이 localhost:3000 으로 새어나간다. 프록시가 넘긴
  // X-Forwarded-Host/Proto(없으면 Host)로 외부 오리진을 재구성해 유효한 절대 URL 을 만든다.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  // Next 가 nonce 를 인식하도록 요청 헤더에도 싣는다(x-nonce + CSP). 클라이언트가 보낸 값은 덮어쓴다.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const next = () => {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };
  const redirectTo = (url: URL) => {
    const res = NextResponse.redirect(url);
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  // 인증 불필요 경로
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const payload = token ? await decodeToken(token) : null;
  if (!payload) {
    // API 요청은 401, 페이지 요청은 로그인 리다이렉트
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL(`${forwardedOrigin(request)}/login`);
    loginUrl.searchParams.set("redirect", pathname);
    return redirectTo(loginUrl);
  }

  // 비밀번호 강제변경(관리자 초기화 등): /change-password 외 모든 경로 차단.
  //   /login·/api/auth·/_next 등은 상단 인증불필요 블록에서 이미 통과했다.
  if (payload.mcp && pathname !== "/change-password") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "PASSWORD_CHANGE_REQUIRED" }, { status: 403 });
    }
    return redirectTo(new URL(`${forwardedOrigin(request)}/change-password`));
  }

  // 역할 게이트: 총괄 전용 API 접두사는 admin만 (방어적; 핸들러 assertAdmin이 최종 권위)
  if (
    payload.role !== "admin" &&
    ADMIN_ONLY_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

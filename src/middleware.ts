import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "rack_session";

function getSecret(): string {
  return process.env.AUTH_SECRET || "CHANGE-THIS-SECRET-IN-PRODUCTION";
}

async function verifyToken(token: string): Promise<boolean> {
  try {
    const [json, sig] = token.split(".");
    if (!json || !sig) return false;

    // Edge Runtime: Web Crypto API — SHA-512
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(getSecret()),
      { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(json));
    const expected = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    if (sig !== expected) return false;
    const payload = JSON.parse(atob(json.replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp > Date.now();
  } catch {
    return false;
  }
}

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
  if (!token || !(await verifyToken(token))) {
    // API 요청은 401, 페이지 요청은 로그인 리다이렉트
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

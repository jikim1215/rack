import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "rack_session";
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24h

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret === "rack-asset-mgr-2024-secret-key") {
    // 운영 환경에서는 반드시 .env에 강력한 비밀키 설정 필요
    console.warn("[SECURITY] AUTH_SECRET이 설정되지 않았거나 기본값입니다. .env에서 변경하세요.");
  }
  return secret || "CHANGE-THIS-SECRET-IN-PRODUCTION";
}

// --- Password hashing (scrypt + salt) ---
export function hashPassword(password: string): string {
  const salt = randomBytes(32).toString("hex"); // 32바이트 솔트 (기존 16 → 강화)
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const buf = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(buf, Buffer.from(hash, "hex"));
}

// --- Session token (HMAC-SHA512 signed) ---
export interface SessionPayload {
  userId: number;
  username: string;
  displayName: string;
  role: string;
  exp: number;
}

export function createSessionToken(payload: Omit<SessionPayload, "exp">): string {
  const data: SessionPayload = { ...payload, exp: Date.now() + SESSION_TTL };
  const json = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = createHmac("sha512", getSecret()).update(json).digest("base64url"); // SHA-256 → SHA-512
  return `${json}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const [json, sig] = token.split(".");
    if (!json || !sig) return null;
    const expected = createHmac("sha512", getSecret()).update(json).digest("base64url"); // SHA-512
    if (sig !== expected) return null;
    const payload: SessionPayload = JSON.parse(Buffer.from(json, "base64url").toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function sessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure: false, // 폐쇄망 HTTP (HTTPS 사용 시 true로 변경)
    sameSite: "strict" as const, // lax → strict (CSRF 강화)
    path: "/",
    maxAge: SESSION_TTL / 1000,
  };
}

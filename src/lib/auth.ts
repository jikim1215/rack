import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "rack_session";
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24h

function getSecret(): string {
  return process.env.AUTH_SECRET || "rack-asset-manager-default-secret-change-me";
}

// --- Password hashing ---
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const buf = scryptSync(password, salt, 64);
  return timingSafeEqual(buf, Buffer.from(hash, "hex"));
}

// --- Session token (HMAC-signed, no DB lookup needed → Edge compatible) ---
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
  const sig = createHmac("sha256", getSecret()).update(json).digest("base64url");
  return `${json}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const [json, sig] = token.split(".");
    if (!json || !sig) return null;
    const expected = createHmac("sha256", getSecret()).update(json).digest("base64url");
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
    secure: false, // 폐쇄망 HTTP
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL / 1000,
  };
}

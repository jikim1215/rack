// ── 인증 코어 (순수 모듈) ──
// Next.js 런타임 의존(next/headers, DB)이 없어 단위테스트와 스크립트에서 직접 임포트할 수 있다.
// 세션 조회(getSession)는 src/lib/auth.ts — 서버측 폐기 검증(is_active/token_version) 포함.
//
// ── 비밀번호 해시 규약 (중요) ──
// 저장 형식: `${salt}:${scrypt(sha512(평문), salt)}` — scrypt 파라미터 N=16384, r=8, p=1.
// 클라이언트(LoginForm)가 평문을 SHA-512로 프리해시해 전송하므로, 서버의 hashPassword/verifyPassword가
// 받는 `password` 인자는 이미 sha512(평문) 문자열이다. 시드(db-seed.mjs)는 평문을 갖고 있으므로
// 서버측에서 sha512를 직접 적용해 동일한 규약을 만든다. 두 경로 모두 최종 저장물은 같다.
// 주의: 프리해시는 전송구간 보호가 아니다(재전송 가능) — 전송 보호는 TLS가 담당(docs/deploy-tls.md).
import { scryptSync, randomBytes, timingSafeEqual, createHmac, createHash } from "crypto";

export const SESSION_COOKIE = "asset_session";
// 세션 수명: 기관 정책에 맞게 SESSION_TTL_HOURS 로 조정(기본 24h). 짧게 두고 만료 임박 배너의
// "세션 연장"(활동자만 연장)과 조합하면 사실상의 유휴 타임아웃으로 동작한다.
const SESSION_TTL = (Number(process.env.SESSION_TTL_HOURS) > 0 ? Number(process.env.SESSION_TTL_HOURS) : 24) * 60 * 60 * 1000;

const DEFAULT_SECRETS = new Set([
  "rack-asset-mgr-2024-secret-key",
  "CHANGE-THIS-SECRET-IN-PRODUCTION",
]);
const DEV_FALLBACK_SECRET = "dev-only-insecure-secret-do-not-use-in-production";

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || DEFAULT_SECRETS.has(secret)) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[SECURITY] AUTH_SECRET이 설정되지 않았거나 기본값입니다. 운영 환경에서는 강력한 무작위 값을 .env에 설정해야 합니다."
      );
    }
    console.warn(
      "[SECURITY] AUTH_SECRET이 설정되지 않았거나 기본값입니다. 개발 모드 임시 키를 사용합니다 — 운영 배포 금지."
    );
    return DEV_FALLBACK_SECRET;
  }
  return secret;
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

// 서버측 프리해시(sha512) + scrypt. 시드/초기화처럼 평문을 가진 경로에서
// 클라이언트(LoginForm) 프리해시 규약과 동일한 저장물을 만든다.
// 초기화(reset) 규약: 초기 비밀번호 = 사용자 이메일 → 서버에서 이 함수로 해시해 저장한다.
export function hashPlaintextPassword(plain: string): string {
  const pre = createHash("sha512").update(plain).digest("hex");
  return hashPassword(pre);
}


// --- 비밀번호 정책 (P10 보안 하드닝, AC-18) ---
// 폐쇄망 내부 시스템 기준: 최소 8자, 영문/숫자/특수문자 중 2종 이상 조합, 256자 이하.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;
export function validatePasswordPolicy(password: unknown): string | null {
  if (typeof password !== "string") return "비밀번호를 입력하세요.";
  if (password.length < PASSWORD_MIN_LENGTH) return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `비밀번호는 ${PASSWORD_MAX_LENGTH}자 이하여야 합니다.`;
  const classes = [/[a-zA-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(re => re.test(password)).length;
  if (classes < 2) return "비밀번호는 영문/숫자/특수문자 중 2종 이상을 포함해야 합니다.";
  return null;
}

// --- Session token (HMAC-SHA512 signed) ---
export type Role = "admin" | "team" | "viewer";

export interface SessionPayload {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  teamId: number | null;
  /** 토큰 버전 — users.token_version과 일치해야 유효. 비밀번호 변경/강제 로그아웃 시 서버가 올린다. 구버전 토큰은 0으로 간주. */
  tv?: number;
  /** mustChangePassword — 관리자 비밀번호 초기화/강제변경. true면 미들웨어가 /change-password 로 유도. */
  mcp?: boolean;
  exp: number;
}

export function createSessionToken(payload: Omit<SessionPayload, "exp">): string {
  const data: SessionPayload = { ...payload, exp: Date.now() + SESSION_TTL };
  const json = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = createHmac("sha512", getSecret()).update(json).digest("base64url");
  return `${json}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const [json, sig] = token.split(".");
    if (!json || !sig) return null;
    const expected = createHmac("sha512", getSecret()).update(json).digest("base64url");
    // 상수시간 비교 (타이밍 공격 방어, P10/AC-18)
    const sigBuf = Buffer.from(sig, "base64url");
    const expBuf = Buffer.from(expected, "base64url");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    const payload: SessionPayload = JSON.parse(Buffer.from(json, "base64url").toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    // HTTPS(Node TLS) 배포 시 COOKIE_SECURE=true (setup.sh가 설정). 폐쇄망 HTTP-only면 미설정→false.
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "strict" as const, // lax → strict (CSRF 강화)
    path: "/",
    maxAge: SESSION_TTL / 1000,
  };
}

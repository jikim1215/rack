// ── 인증 코어 (순수 모듈) ──
// Next.js 런타임 의존(next/headers, DB)이 없어 단위테스트와 스크립트에서 직접 임포트할 수 있다.
// 세션 조회(getSession)는 src/lib/auth.ts — 서버측 폐기 검증(is_active/token_version) 포함.
//
// ── 비밀번호 해시 규약 (중요) ──
// 저장 형식: `${salt}:${scrypt(sha512(평문), salt)}` — scrypt 파라미터 N=16384, r=8, p=1.
// 클라이언트(LoginForm)가 평문을 SHA-512로 프리해시해 전송하므로, 서버의 hashPassword/verifyPassword가
// 받는 `password` 인자는 이미 sha512(평문) 문자열이다. 시드(db-seed.mjs)는 평문을 갖고 있으므로
// 서버측에서 sha512를 직접 적용해 동일한 규약을 만든다. 두 경로 모두 최종 저장물은 같다.
// 주의: 프리해시는 전송구간 보호가 아니다(재전송 가능) — 전송 보호는 TLS(nginx 종단, docs/DEPLOY.md)가 담당.
import { scryptSync, randomBytes, timingSafeEqual, createHmac, createHash } from "crypto";

export const SESSION_COOKIE = "asset_session";
// 세션 수명: 기관 정책에 맞게 SESSION_TTL_HOURS 로 조정(기본 8h = 근무 1일, P4 보안 리뷰 반영 — 공용 PC에서 퇴근 후 세션이 다음날까지 살아있지 않게).
// 만료 임박 배너의 "세션 연장"(활동자만 연장)과 조합하면 사실상의 유휴 타임아웃으로 동작한다.
export const SESSION_TTL_DEFAULT_HOURS = 8;
const SESSION_TTL = (Number(process.env.SESSION_TTL_HOURS) > 0 ? Number(process.env.SESSION_TTL_HOURS) : SESSION_TTL_DEFAULT_HOURS) * 60 * 60 * 1000;

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


// --- 비밀번호 정책 — src/lib/password-policy.ts (클라이언트와 공유하는 동형 모듈)에서 재수출 ---
export { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, validatePasswordPolicy } from "./password-policy.ts";

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
  /**
   * mfaSetupRequired — 역할이 MFA_REQUIRED_ROLES 에 속하는데 아직 2단계 인증을 등록하지 않았다.
   * true 면 미들웨어가 /settings?tab=mfa 로 유도하고 등록 API 외는 막는다. 등록 완료 시 세션을 재발급해 해제.
   */
  msr?: boolean;
  /**
   * 토큰 용도. 없으면 정상 세션.
   * "mfa" = 1차(비밀번호)만 통과한 임시 토큰 — 2단계 코드 교환 전용이라 세션으로 쓰지 못한다(getSession 이 거부).
   */
  pur?: "mfa";
  exp: number;
}

/** 2단계 인증 대기 토큰 수명 — 코드 입력할 만큼만 짧게. */
export const MFA_PENDING_TTL_MS = 3 * 60 * 1000;

/**
 * 2단계 인증 등록이 강제되는 역할 — 환경변수 MFA_REQUIRED_ROLES (쉼표 구분, 예: "admin" 또는 "admin,team").
 * 비어 있으면 강제 없음(선택 등록). 기본값은 admin — 총괄 계정이 계정·권한·감사로그를 줌어에서 가장 보호가 필요하다.
 * 환경변수로 끄려면 MFA_REQUIRED_ROLES=none.
 */
export function mfaRequiredRoles(): ReadonlySet<Role> {
  const raw = (process.env.MFA_REQUIRED_ROLES ?? "admin").trim().toLowerCase();
  if (!raw || raw === "none") return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter((s): s is Role => s === "admin" || s === "team" || s === "viewer"));
}

export function createSessionToken(payload: Omit<SessionPayload, "exp">, ttlMs: number = SESSION_TTL): string {
  const data: SessionPayload = { ...payload, exp: Date.now() + ttlMs };
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

/**
 * 2단계 인증 대기 토큰 발급 — 1차 인증(비밀번호) 통과 사실만 담는다.
 * 이 토큰은 getSession 이 거부하므로 어떤 화면·API 접근에도 쓸 수 없다. 오직 /api/auth/mfa 교환용.
 */
export function createMfaPendingToken(payload: Omit<SessionPayload, "exp" | "pur">): string {
  return createSessionToken({ ...payload, pur: "mfa" }, MFA_PENDING_TTL_MS);
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

// ── TOTP 2단계 인증 (RFC 6238 / RFC 4226) — 순수 모듈 ──
// 폐쇄망 전제: 인증 앱(Google/Microsoft Authenticator 등)은 서버와 통신하지 않는다. 시간만 맞으면 동작한다.
// 외부 패키지 0 (node:crypto 만 사용) — ADR-006(의존성 최소화) 및 오프라인 번들 반입 부담 회피.
//
// 규약: SHA-1 · 6자리 · 30초 스텝 (인증 앱 기본값. 다른 값은 앱 호환성이 떨어져 쓰지 않는다)
// 재사용 방지: 검증 성공한 counter 를 users.totp_last_counter 에 저장하고, 그 이하는 거부한다
//              (같은 30초 창의 코드를 훔쳐 재제출하는 replay 차단).
import { createHmac, randomBytes, timingSafeEqual, scryptSync } from "crypto";

export const TOTP_DIGITS = 6;
export const TOTP_STEP_SEC = 30;
/** 시계 오차 허용 폭(스텝). ±1 = 앞뒤 30초. 더 넓히면 replay 창이 커진다. */
export const TOTP_WINDOW = 1;
/** 시크릿 길이(바이트). RFC 4226 권장 최소 16, 여기서는 20바이트(160비트) = base32 32자. */
const SECRET_BYTES = 20;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 바이트열 → base32 (RFC 4648, 패딩 없음). 인증 앱이 읽는 형식. */
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** base32 → 바이트열. 공백/하이픈/소문자/패딩(=) 허용. 유효하지 않은 문자는 오류. */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!clean) throw new Error("빈 시크릿");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`base32 가 아닌 문자: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 새 TOTP 시크릿(base32 32자). 등록 시 1회 생성해 사용자에게 보여주고 DB에 저장한다. */
export function generateSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** 수기 입력용 표기 — 4자씩 끊어 읽기 쉽게 (QR 없이도 등록 가능하게). */
export function formatSecretForDisplay(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(" ");
}

/** 현재 시각(ms) → TOTP counter. */
export function counterAt(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SEC);
}

/** HOTP (RFC 4226) — counter 기반 6자리 코드. */
export function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  // counter 는 64비트지만 안전정수 범위 내(서기 몇만 년까지)이므로 상·하위 32비트로 분할
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** 현재 시각 기준 코드 (테스트·진단용). */
export function totp(secret: string, nowMs: number = Date.now()): string {
  return hotp(secret, counterAt(nowMs));
}

export interface VerifyResult {
  /** 검증 통과 여부 */
  ok: boolean;
  /** 통과한 counter (성공 시). 호출부가 users.totp_last_counter 에 저장해 재사용을 막는다. */
  counter?: number;
  /** 실패 사유 — 'format'(6자리 아님) | 'mismatch'(코드 불일치) | 'replay'(이미 쓴 코드) */
  reason?: "format" | "mismatch" | "replay";
}

/**
 * TOTP 코드 검증. ±TOTP_WINDOW 스텝을 허용하고, lastCounter 이하는 replay 로 거부한다.
 * @param lastCounter 이 사용자가 마지막으로 성공한 counter (없으면 0)
 */
export function verifyTotp(
  secret: string,
  code: string,
  opts: { lastCounter?: number; nowMs?: number } = {},
): VerifyResult {
  const digits = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return { ok: false, reason: "format" };
  const last = opts.lastCounter ?? 0;
  const now = counterAt(opts.nowMs ?? Date.now());
  let matched: number | null = null;
  // 상수시간 비교로 각 후보를 모두 확인 (조기 반환으로 타이밍 차가 새지 않게)
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d++) {
    const c = now + d;
    if (c < 0) continue;
    const expected = Buffer.from(hotp(secret, c));
    const given = Buffer.from(digits);
    if (expected.length === given.length && timingSafeEqual(expected, given)) matched = c;
  }
  if (matched === null) return { ok: false, reason: "mismatch" };
  if (matched <= last) return { ok: false, reason: "replay" };
  return { ok: true, counter: matched };
}

/**
 * 인증 앱 등록용 otpauth:// URI. QR 로 만들 수도 있고, 앱에 직접 붙여넣어도 된다.
 * issuer/label 은 앱 목록에 표시되는 이름이다.
 */
export function otpauthUri(secret: string, account: string, issuer = "정보시스템 자산관리"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── 백업 코드 ──
// 인증 앱을 못 쓰는 상황(기기 분실/교체)의 탈출구. 1회용이며 저장은 해시(scrypt)로만 한다.
export const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 0/1/I/O 제외 (받아적기 오류 방지)

/** 백업 코드 1개 생성 — 'XXXX-XXXX' (8자). */
function makeBackupCode(): string {
  const raw = Array.from(randomBytes(8), (b) => BACKUP_CODE_ALPHABET[b % BACKUP_CODE_ALPHABET.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

/** 백업 코드 10개 생성 → { plain: 사용자에게 1회만 보여줄 코드, hashed: DB 저장용 } */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): { plain: string[]; hashed: string[] } {
  const plain = Array.from({ length: count }, makeBackupCode);
  return { plain, hashed: plain.map(hashBackupCode) };
}

/** 백업 코드 해시 — `${salt}:${scrypt}`. 비밀번호와 동일 규약(파라미터만 경량: 코드가 고엔트로피라 N=16384 불필요). */
export function hashBackupCode(code: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(normalizeBackupCode(code), salt, 32, { N: 4096, r: 8, p: 1 }).toString("hex");
  return `${salt}:${hash}`;
}

/** 입력 정규화 — 공백/하이픈 제거, 대문자. 사용자가 'abcd efgh' 로 쳐도 통과. */
export function normalizeBackupCode(code: string): string {
  return String(code ?? "").replace(/[\s-]/g, "").toUpperCase();
}

/**
 * 백업 코드 검증 — 일치하는 해시의 인덱스를 돌려준다(-1이면 불일치).
 * 호출부는 성공 시 그 인덱스를 목록에서 제거해 1회용을 강제해야 한다.
 */
export function findBackupCode(code: string, hashed: string[]): number {
  const norm = normalizeBackupCode(code);
  if (!norm) return -1;
  for (let i = 0; i < hashed.length; i++) {
    const [salt, hash] = String(hashed[i]).split(":");
    if (!salt || !hash) continue;
    const buf = scryptSync(norm, salt, 32, { N: 4096, r: 8, p: 1 });
    const stored = Buffer.from(hash, "hex");
    if (buf.length === stored.length && timingSafeEqual(buf, stored)) return i;
  }
  return -1;
}

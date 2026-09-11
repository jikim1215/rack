// ── 쓰기 API 입력 검증 헬퍼 (순수 모듈) ──
// 라우트가 요청 본문을 DB에 넣기 전에 형식·enum·길이·범위를 확인해 400(사용자 메시지)으로 돌려준다.
// 검증 없이 넣으면 SQLite CHECK/NOT NULL 예외가 500으로 새어나갔다(P2). withApi 가 ValidationError 를 400 으로 변환한다.
// 모든 헬퍼는 body(unknown 객체)와 key 를 받아 정규화된 값을 반환하거나 ValidationError 를 던진다.

export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

type Body = Record<string, unknown>;

/** 요청 본문을 객체로 강제. 배열/원시값이면 400. */
export function asBody(body: unknown): Body {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("요청 본문이 올바르지 않습니다.");
  return body as Body;
}

export interface StrOpts { required?: boolean; max?: number; label?: string; default?: string }

/** 문자열 필드. 없으면 default(기본 ''), required 면 공백 거부, max 초과 거부. */
export function str(body: Body, key: string, opts: StrOpts = {}): string {
  const raw = body[key];
  const label = opts.label ?? key;
  const v = raw === undefined || raw === null ? (opts.default ?? "") : String(raw).trim();
  if (opts.required && !v) throw new ValidationError(`${label}을(를) 입력하세요.`);
  const max = opts.max ?? 2000;
  if (v.length > max) throw new ValidationError(`${label}은(는) ${max}자 이하여야 합니다.`);
  return v;
}

export interface EnumOpts<T extends string> { label?: string; default?: T; required?: boolean }

/** enum 필드. 값이 없으면 default(없으면 required 여부에 따라 400/undefined). 허용 밖 값은 400. */
export function oneOf<T extends string>(body: Body, key: string, allowed: readonly T[], opts: EnumOpts<T> = {}): T {
  const raw = body[key];
  const label = opts.label ?? key;
  if (raw === undefined || raw === null || raw === "") {
    if (opts.default !== undefined) return opts.default;
    if (opts.required) throw new ValidationError(`${label}을(를) 선택하세요.`);
    throw new ValidationError(`${label}이(가) 필요합니다.`);
  }
  const v = String(raw);
  if (!(allowed as readonly string[]).includes(v)) {
    throw new ValidationError(`${label} 값이 올바르지 않습니다. (허용: ${allowed.join(", ")})`);
  }
  return v as T;
}

export interface IntOpts { min?: number; max?: number; label?: string; required?: boolean; default?: number }

/** 정수 필드. 빈 값은 default 또는 null(required 면 400). 비정수/범위 밖은 400. */
export function int(body: Body, key: string, opts: IntOpts = {}): number | null {
  const raw = body[key];
  const label = opts.label ?? key;
  if (raw === undefined || raw === null || raw === "") {
    if (opts.default !== undefined) return opts.default;
    if (opts.required) throw new ValidationError(`${label}을(를) 입력하세요.`);
    return null;
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n)) throw new ValidationError(`${label}은(는) 정수여야 합니다.`);
  if (opts.min !== undefined && n < opts.min) throw new ValidationError(`${label}은(는) ${opts.min} 이상이어야 합니다.`);
  if (opts.max !== undefined && n > opts.max) throw new ValidationError(`${label}은(는) ${opts.max} 이하여야 합니다.`);
  return n;
}

/** 양의 정수 ID 또는 null (0/빈값/null → null). 음수·비정수는 400. */
export function idOrNull(body: Body, key: string, label?: string): number | null {
  const n = int(body, key, { label: label ?? key, min: 0 });
  return n === null || n === 0 ? null : n;
}

/** 0/1 플래그. boolean/숫자/문자('1','true') 허용. */
export function flag(body: Body, key: string, def = 0): 0 | 1 {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === "") return def as 0 | 1;
  if (raw === true || raw === 1 || raw === "1" || raw === "true") return 1;
  if (raw === false || raw === 0 || raw === "0" || raw === "false") return 0;
  throw new ValidationError(`${key} 값이 올바르지 않습니다.`);
}

/**
 * 날짜 정규화 → 'YYYY-MM-DD' | ''(빈값) | null(해석 불가).
 * 엑셀 임포트로 들어온 레거시 값(엑셀 일련번호 45123, '2023.01.05', '2023/1/5', '20230105', '2023-01-05 00:00:00')을
 * 임포트·수정 검증·마이그레이션이 같은 규칙으로 받는다 (비평 반영: 임포트 자산이 날짜 형식 때문에 편집 불가해지는 회귀 방지).
 */
export function normalizeDate(raw: unknown): string | null {
  if (raw === undefined || raw === null) return "";
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  const s = String(raw).trim();
  if (!s) return "";
  // 엑셀 일련번호 (1900-01-01 기준 1, 1899-12-30 epoch) — 1990~2100년 범위만 인정
  if (/^\d{4,6}(\.\d+)?$/.test(s) && !/^\d{8}$/.test(s)) {
    const n = Number(s);
    if (n >= 32874 && n <= 73415) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    return null;
  }
  const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T].*)?$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null; // 2월 30일 등
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 날짜 필드 → 'YYYY-MM-DD' 또는 빈 문자열. 해석 불가 형식은 400. (normalizeDate 규칙으로 레거시 표기도 받는다) */
export function dateStr(body: Body, key: string, opts: { label?: string; required?: boolean } = {}): string {
  const label = opts.label ?? key;
  const raw = body[key];
  const v = normalizeDate(raw);
  if (v === null) throw new ValidationError(`${label}은(는) YYYY-MM-DD 형식이어야 합니다. (입력값: ${String(raw).slice(0, 30)})`);
  if (opts.required && !v) throw new ValidationError(`${label}을(를) 입력하세요.`);
  return v;
}

/**
 * PUT 용 날짜 필드: 입력값이 기존 저장값과 동일하면(사용자가 건드리지 않음) 형식 검사 없이 그대로 보존한다.
 * 정규화되지 않은 레거시 날짜 때문에 다른 필드 편집까지 막히지 않게 (자산/계약 PUT 공통).
 */
export function dateStrKeep(body: Body, key: string, existing: string | null | undefined, opts: { label?: string } = {}): string {
  const raw = body[key];
  if (existing !== undefined && existing !== null && String(raw ?? "") === existing) return existing;
  return dateStr(body, key, opts);
}

/** 경로 파라미터 id. 양의 정수가 아니면 400. */
export function pathId(raw: string, label = "id"): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ValidationError(`${label}이(가) 올바르지 않습니다.`);
  return n;
}

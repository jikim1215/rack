// ── 사용자별 IP 접근제어 (모델: 사용자마다 허용 IP/대역 지정) ──
// 순수 모듈 — DB/런타임 의존 없음(단위테스트 가능).
//
// users.allowed_ips: 콤마/개행/공백 구분의 IPv4 또는 CIDR 목록.
//   비어있으면(=규칙 0개) 그 사용자는 IP 제한 없음(어디서나 로그인 가능).
//   하나라도 있으면 화이트리스트 — 매칭되는 규칙이 없으면 접근 거부.
//
// 클라이언트 IP 는 로그인 API 의 clientMeta(TRUST_PROXY=true 필요)에서 온다.
// 프록시 뒤(nginx X-Forwarded-For)가 아니면 "direct"로 수렴 → 규칙 존재 시 거부됨.

/** IPv4 문자열을 32비트 부호없는 정수로. 형식 오류면 null. */
export function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec((ip || "").trim());
  if (!m) return null;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (o.some((n) => n > 255)) return null;
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
}

/** "IP" 또는 "IP/prefix" 규칙이 유효한지 검사. */
export function isValidRule(rule: string): boolean {
  const r = (rule || "").trim();
  if (r === "") return false;
  const [ip, prefix] = r.split("/");
  if (ipv4ToInt(ip) === null) return false;
  if (prefix === undefined) return true; // 단일 IP = /32
  if (!/^\d{1,2}$/.test(prefix)) return false;
  const p = Number(prefix);
  return p >= 0 && p <= 32;
}

/** allowed_ips 문자열 → 규칙 배열(유효한 것만, 중복 제거). */
export function parseRules(allowedIps: string | null | undefined): string[] {
  if (!allowedIps) return [];
  const parts = allowedIps
    .split(/[\s,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return [...new Set(parts.filter(isValidRule))];
}

/** 단일 IP 가 하나의 규칙(IP 또는 CIDR)에 매칭되는지. */
export function matchRule(ip: string, rule: string): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return false;
  const [base, prefix] = rule.trim().split("/");
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const p = prefix === undefined ? 32 : Number(prefix);
  if (p < 0 || p > 32) return false;
  if (p === 0) return true; // 0.0.0.0/0 = 전체
  const mask = (0xffffffff << (32 - p)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/**
 * 접근 허용 판정.
 * @param ip 클라이언트 IPv4 ("direct"/빈값이면 규칙 존재 시 거부)
 * @param allowedIps 사용자 users.allowed_ips 원본 문자열
 * @returns { allowed, restricted } — restricted=false 면 제한 없는 사용자
 */
export function isIpAllowed(
  ip: string | null | undefined,
  allowedIps: string | null | undefined
): { allowed: boolean; restricted: boolean } {
  const rules = parseRules(allowedIps);
  if (rules.length === 0) return { allowed: true, restricted: false }; // 제한 없음
  const cip = (ip || "").trim();
  if (cip === "" || cip === "direct") return { allowed: false, restricted: true };
  return { allowed: rules.some((r) => matchRule(cip, r)), restricted: true };
}

// IPv4 서브넷 계산 — 서버(API)·클라이언트(IPAM 격자)가 같은 정본을 쓴다.
// 비트 연산은 32비트 부호있는 정수라 결과를 항상 >>> 0 으로 부호없는 값으로 정규화한다.

/** 등록 가능한 프리픽스 범위. /16 미만은 IP 격자(대역 전체 셀 렌더)가 감당할 수 없는 크기라 받지 않는다. */
export const SUBNET_PREFIX_MIN = 16;
export const SUBNET_PREFIX_MAX = 32;

const IPV4_STRICT = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** "a.b.c.d" → 부호없는 32비트 정수. 형식 검증은 호출부 책임(isValidIpv4). */
export function ipv4ToNum(ip: string): number {
  return ip.trim().split(".").reduce((acc, o) => ((acc << 8) + Number(o)) >>> 0, 0);
}

/** 프리픽스 길이(0~32) → 마스크 정수. JS 시프트는 32 로 나눈 나머지만 쓰므로(<< 32 === << 0) /0 은 따로 처리한다. */
export function prefixToMaskNum(prefix: number): number {
  return prefix <= 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
}

/** 서브넷 마스크 문자열 → 프리픽스 길이. IPv4 형식이 아니거나 연속 마스크가 아니면(255.0.255.0 등) null. */
export function maskToPrefix(mask: string): number | null {
  if (!IPV4_STRICT.test(mask.trim())) return null;
  const n = ipv4ToNum(mask);
  // 연속 마스크 = 1 들 뒤에 0 만: 반전값 + 1 이 2의 거듭제곱(또는 0 → /0)
  const inv = (~n) >>> 0;
  if ((inv & (inv + 1)) !== 0) return null;
  let bits = 0;
  for (let v = n; v & 0x80000000; v = (v << 1) >>> 0) bits++;
  return bits;
}

/** 대역 범위(네트워크~브로드캐스트, 부호없는 정수). 마스크가 잘못됐으면 null. */
export function subnetRange(networkAddress: string, mask: string): { prefix: number; start: number; end: number } | null {
  const prefix = maskToPrefix(mask);
  if (prefix === null) return null;
  const m = prefixToMaskNum(prefix);
  const start = (ipv4ToNum(networkAddress) & m) >>> 0;
  const end = (start + ((~m) >>> 0)) >>> 0;
  return { prefix, start, end };
}

/** 서브넷 마스크 입력 검증. 통과하면 null, 아니면 사용자 메시지. */
export function subnetMaskError(mask: string): string | null {
  const prefix = maskToPrefix(mask);
  if (prefix === null) return "서브넷 마스크가 올바르지 않습니다(예: 255.255.255.0 — 1 비트가 연속이어야 함).";
  if (prefix < SUBNET_PREFIX_MIN || prefix > SUBNET_PREFIX_MAX) {
    return `서브넷 마스크는 /${SUBNET_PREFIX_MIN}~/${SUBNET_PREFIX_MAX} 범위만 등록할 수 있습니다.`;
  }
  return null;
}

// ── 사용자 계정 관리 순수 로직 (단위테스트 대상) ──
// Next 런타임/DB 의존이 없어 api/users 라우트와 테스트가 함께 임포트한다.
// 목적: 고정 계정(admin 등)도 자유롭게 수정/삭제할 수 있게 하되,
//       "마지막 활성 관리자"가 사라져 아무도 로그인·관리할 수 없게 되는 잠금(lockout)만 방지한다.
// ID 규약: 공존시스템(공존 시스템)와 동일하게 로그인 ID = 이메일. 폐쇄망 내부 계정용 최소 검증.

/** 이메일(로그인 ID) 검증. 오류 메시지 또는 null(정상). */
export function validateEmail(value: unknown): string | null {
  if (typeof value !== "string") return "이메일을 입력하세요.";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "이메일을 입력하세요.";
  if (trimmed.length > 254) return "이메일은 254자 이하여야 합니다.";
  if (/\s/.test(trimmed)) return "이메일에 공백을 포함할 수 없습니다.";
  // local@domain.tld — 폐쇄망 내부 계정용 실용 검증(과도한 RFC 준수는 지양).
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return "올바른 이메일 형식이 아닙니다.";
  return null;
}

/** 저장용 정규화: 트림 + 소문자(대소문자 혼동으로 인한 중복 계정 방지). */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 마지막 활성 관리자(admin) 보호.
 * 이 연산을 적용했을 때 활성 admin이 0명이 되면 true(=차단해야 함)를 반환한다.
 * admin 계정 자체의 수정/삭제는 허용하되, 이 한 가지 경우만 막는다.
 * @param activeAdminIds 연산 전 활성 admin 사용자 id 목록
 * @param targetId 연산 대상 사용자 id
 * @param targetWillBeActiveAdmin 연산 후 대상이 활성 admin으로 남는지 (삭제/비활성/역할강등이면 false)
 */
export function wouldRemoveLastAdmin(
  activeAdminIds: readonly number[],
  targetId: number,
  targetWillBeActiveAdmin: boolean,
): boolean {
  const remaining = new Set(activeAdminIds);
  if (targetWillBeActiveAdmin) remaining.add(targetId);
  else remaining.delete(targetId);
  return remaining.size === 0;
}

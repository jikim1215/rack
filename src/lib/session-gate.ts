// ── 강제 게이트 판정 (순수 모듈 — Edge 미들웨어와 단위테스트가 같은 함수를 쓴다) ──
// 세션 토큰의 두 플래그가 "이 화면 말고는 아무것도 못 한다" 를 만든다:
//   mcp — 비밀번호 강제변경(관리자 초기화·취약 비밀번호 신고) → /change-password 만
//   msr — 2단계 인증 등록 강제(MFA_REQUIRED_ROLES, 미등록)   → /settings(2단계 인증 탭) 만
// 둘이 동시에 켜질 수 있다(2단계 인증 미등록 총괄의 비밀번호를 초기화한 경우).
// 두 게이트를 각자 검사하면 /change-password 는 msr 가 /settings 로, /settings 는 mcp 가 /change-password 로 보내
// 브라우저가 "리디렉션한 횟수가 너무 많습니다" 로 멈춘다. → 한 번에 하나만: 비밀번호 변경이 먼저, 등록은 그다음.
// 비밀번호를 바꾸면 세션이 mcp 없이(msr 는 그대로) 재발급되어 다음 요청부터 등록 게이트가 걸린다.

export type ForcedGate =
  | { error: "PASSWORD_CHANGE_REQUIRED"; page: "/change-password" }
  | { error: "MFA_SETUP_REQUIRED"; page: "/settings?tab=mfa&required=1" };

/** 막아야 하면 API 응답 코드와 보낼 화면, 통과면 null. 인증 불필요 경로(/login·/api/auth/* 등)는 호출 전에 걸러져 있어야 한다. */
export function forcedGate(flags: { mcp?: boolean; msr?: boolean }, pathname: string): ForcedGate | null {
  if (flags.mcp) {
    return pathname === "/change-password" ? null : { error: "PASSWORD_CHANGE_REQUIRED", page: "/change-password" };
  }
  if (flags.msr) {
    return pathname === "/settings" ? null : { error: "MFA_SETUP_REQUIRED", page: "/settings?tab=mfa&required=1" };
  }
  return null;
}

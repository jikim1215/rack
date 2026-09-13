// ── 비밀번호 정책 (P10 보안 하드닝, AC-18) — 동형(isomorphic) 순수 모듈 ──
// 서버(변경·초기화 API)와 클라이언트(로그인 화면의 취약 비밀번호 감지)가 같은 규칙을 공유한다.
// 클라이언트가 왜 필요한가: 로그인은 평문을 sha512 로 프리해시해 보내므로 서버는 평문을 볼 수 없다.
//   → 정책 이전에 만들어진 취약 비밀번호(예: 영문만 8자)는 서버가 로그인 시점에 판별할 수 없다.
//   → 평문을 아는 유일한 곳(브라우저)에서 판정해 /api/auth/password/weak 로 "강제 변경" 을 스스로 켠다.
//   이 호출을 건너뛰어도 얻는 이득은 "정책 위반 비밀번호를 계속 쓰는 것" 뿐이라 서버 신뢰 경계를 넘지 않는다.
// 폐쇄망 내부 시스템 기준: 최소 8자, 영문/숫자/특수문자 중 2종 이상 조합, 256자 이하.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

export function validatePasswordPolicy(password: unknown): string | null {
  if (typeof password !== "string") return "비밀번호를 입력하세요.";
  if (password.length < PASSWORD_MIN_LENGTH) return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `비밀번호는 ${PASSWORD_MAX_LENGTH}자 이하여야 합니다.`;
  const classes = [/[a-zA-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 2) return "비밀번호는 영문/숫자/특수문자 중 2종 이상을 포함해야 합니다.";
  return null;
}

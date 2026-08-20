// 접근 IP 다중값 유틸. 자산은 여러 IP로 접근/관리될 수 있어 접근 IP는 다중값을 허용한다.
// 입력은 파이프(|)/콤마(,)/줄바꿈 혼용을 허용하고, 저장은 ", " 조인 단일 컬럼(assets.access_ip)에
// 정규화한다(스키마 변경 없이 하위호환: 단일값은 그대로, 다중값은 조인). 표시/IPAM/서브넷은 split해 쓴다.
// 순수 모듈(프레임워크/DB import 없음) — API·페이지·스크립트가 동일 규칙을 공유한다.

const SPLIT_RE = /[|,\r\n]+/;

// 다중 접근 IP를 토큰 배열로 분리(트림·공백제거·중복제거·순서보존).
export function splitAccessIps(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const tok of String(value).split(SPLIT_RE)) {
    const t = tok.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

// 저장용 정규화: 혼용 구분자를 ", " 단일 표기로 통일. 값 자체는 버리지 않는다(형식검증은 별도 계층).
export function normalizeAccessIps(value: string | null | undefined): string {
  return splitAccessIps(value).join(", ");
}

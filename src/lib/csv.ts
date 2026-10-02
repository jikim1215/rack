// CSV 셀 직렬화 — 서버 내보내기(감사로그·접속기록)와 클라이언트 다운로드가 같은 규칙을 쓴다.
// CSV 수식 주입(OWASP "CSV Injection") 방지: 엑셀/한셀이 =,+,-,@ 및 TAB·CR 로 시작하는 셀을 수식으로 해석하므로
// 앞에 작은따옴표를 붙여 문자열로 고정한다. 자산명·사용자명·감사 old/new 값은 사용자가 입력한 값이라 그대로 내보내면
// "=HYPERLINK(…)" 같은 셀이 관리자 PC 에서 실행된다. (xlsx 내보내기는 셀을 문자열 타입으로 저장해 해당 없음.)
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  let s = String(val);
  if (FORMULA_LEAD.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** BOM(엑셀 한글 인식) + CRLF 행 구분 CSV 문서. */
export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** 내보내기 파일명용 KST 시각 "YYYYMMDD-HHmm" (서버 TZ 와 무관). */
export function kstStamp(now: Date = new Date()): string {
  const k = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}-${p(k.getUTCHours())}${p(k.getUTCMinutes())}`;
}

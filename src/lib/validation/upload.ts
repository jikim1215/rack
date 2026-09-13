// ── 업로드 파일 상한 (순수 모듈) ──
// 엑셀 임포트 4종(자산·부속·유지관리대상·배선 일괄)이 공통으로 쓴다.
// 크기 상한은 XLSX.read 가 메모리에 전부 올리기 때문에 필요하고(실수로 올린 수십 MB 파일이 서비스를 세운다),
// 행 상한은 한 요청에서 트랜잭션·감사로그가 무한정 커지지 않게 한다. 정상 업무 범위(수천 행)는 넉넉히 통과.
import { ValidationError } from "./input.ts";

export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;   // 20MB — 1만 행 xlsx 도 보통 2~3MB
export const UPLOAD_MAX_ROWS = 20_000;               // 헤더 제외 데이터 행

export function assertUploadSize(file: { size: number; name?: string } | null): asserts file is { size: number; name?: string } {
  if (!file) throw new ValidationError("파일이 없습니다.");
  if (file.size === 0) throw new ValidationError("빈 파일입니다.");
  if (file.size > UPLOAD_MAX_BYTES) {
    throw new ValidationError(
      `파일이 너무 큽니다 (${(file.size / 1048576).toFixed(1)}MB). 최대 ${UPLOAD_MAX_BYTES / 1048576}MB — 시트를 나눠 올리세요.`,
    );
  }
}

export function assertRowLimit(dataRowCount: number) {
  if (dataRowCount > UPLOAD_MAX_ROWS) {
    throw new ValidationError(`행이 너무 많습니다 (${dataRowCount.toLocaleString()}행). 한 번에 최대 ${UPLOAD_MAX_ROWS.toLocaleString()}행 — 나눠 올리세요.`);
  }
}

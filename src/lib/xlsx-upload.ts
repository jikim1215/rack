// 엑셀 업로드 공통 입구 — 임포트 5종(자산·부속자산·유지관리대상·배선반 일괄·선번장)이 이 함수 하나로 시트를 읽는다.
// 순서가 곧 방어선: 크기 상한 → 매직바이트(.xlsx 만) → 압축 해제 총량(압축 폭탄) → 파싱(실패=400) → 행 상한.
// 라우트마다 일부 단계를 빼먹던 드리프트(배선반 2종은 매직바이트·폭탄 검사 없이 XLSX.read)를 구조로 막는다.
import * as XLSX from "xlsx";
import { ValidationError } from "./validation/input.ts";
import { assertRowLimit, assertUploadSize, assertXlsxExpansion } from "./validation/upload.ts";
import { isXlsxBuffer } from "./validation/asset-rules.ts";

export interface UploadSheetOptions {
  /** 날짜 셀을 Date 로 (부속자산·유지관리대상 임포트). */
  cellDates?: boolean;
  /** 빈 셀을 "" 로 채움 (배선반 양식은 열 위치로 읽는다). */
  defval?: string;
  /** 빈 행 유지 여부 (기본 유지 — 원본 행 번호를 보고에 쓴다). */
  blankrows?: boolean;
  /** 헤더 행 수(행 상한 계산에서 제외). 양식마다 헤더 위치가 달라 데이터 행 상한은 호출측이 다시 셀 수 있다. */
  headerRows?: number;
}

/** 업로드된 File → 첫 시트의 2차원 배열. 모든 실패는 ValidationError(400, 한국어 메시지). */
export async function readUploadSheet(file: File | null, opts: UploadSheetOptions = {}): Promise<unknown[][]> {
  assertUploadSize(file);
  const buf = Buffer.from(await (file as File).arrayBuffer());
  return parseUploadBuffer(buf, opts);
}

/** 버퍼 단계(테스트·내부용). readUploadSheet 와 같은 검사 순서. */
export function parseUploadBuffer(buf: Buffer, opts: UploadSheetOptions = {}): unknown[][] {
  if (!isXlsxBuffer(buf)) throw new ValidationError("유효한 .xlsx 파일이 아닙니다 (매직바이트 불일치). 엑셀에서 .xlsx 로 저장해 올리세요.");
  assertXlsxExpansion(buf);
  let rows: unknown[][];
  try {
    // dense: 시트를 셀 주소 키 객체 대신 행 배열로 — 결과(sheet_to_json)는 동일, 상한 직전 최악 파일(240만 셀) 기준
    // 피크 메모리 588→421MB·시간 9.7→6.0초(실측). 운영 VM 가용 메모리가 750MB 안팎이라 여유가 중요하다.
    const wb = XLSX.read(buf, { type: "buffer", cellDates: opts.cellDates ?? false, dense: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = ws
      ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: opts.defval, blankrows: opts.blankrows ?? true })
      : [];
    // dense 시트는 완전히 빈 행을 defval 로 채우지 않고 [] 를 준다(sparse 는 범위 폭만큼 채움) → 동일 결과로 보정
    if (ws?.["!ref"] && opts.defval !== undefined) {
      const range = XLSX.utils.decode_range(ws["!ref"]);
      const width = range.e.c - range.s.c + 1;
      for (const row of rows) while (row.length < width) row.push(opts.defval);
    }
  } catch {
    throw new ValidationError("엑셀 파일을 읽지 못했습니다 (손상되었거나 암호가 걸린 파일).");
  }
  assertRowLimit(Math.max(0, rows.length - (opts.headerRows ?? 1)));
  return rows;
}

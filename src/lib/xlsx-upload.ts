// 엑셀 업로드 공통 입구 — 임포트 5종(자산·부속자산·유지관리대상·배선반 일괄·선번장)이 이 함수 하나로 시트를 읽는다.
// 순서가 곧 방어선: 크기 상한 → 매직바이트(.xlsx 만) → 압축 해제 총량(압축 폭탄) → 파싱(실패=400) → 행 상한.
// 라우트마다 일부 단계를 빼먹던 드리프트(배선반 2종은 매직바이트·폭탄 검사 없이 parse)를 구조로 막는다.
import ExcelJS from "exceljs";
import { ValidationError } from "./validation/input.ts";
import { assertRowLimit, assertUploadSize } from "./validation/upload.ts";
import { assertXlsxExpansion } from "./validation/upload.ts";
import { isXlsxBuffer } from "./validation/asset-rules.ts";

export interface UploadSheetOptions {
  /** 날짜 셀을 Date 로 (부속자산·유지관리대상 임포트). ExcelJS 는 항상 Date 객체로 반환하므로 플래그 무관하게 동일하게 동작. */
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
export async function parseUploadBuffer(buf: Buffer, opts: UploadSheetOptions = {}): Promise<unknown[][]> {
  if (!isXlsxBuffer(buf)) throw new ValidationError("유효한 .xlsx 파일이 아닙니다 (매직바이트 불일치). 엑셀에서 .xlsx 로 저장해 올리세요.");
  assertXlsxExpansion(buf);
  let rows: unknown[][];
  try {
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buf as unknown as any);
    const ws = wb.worksheets[0];
    if (!ws) {
      rows = [];
    } else {
      const includeEmpty = opts.blankrows ?? true;
      const colCount = ws.columnCount;
      rows = [];
      ws.eachRow({ includeEmpty }, (row) => {
        const rowData: unknown[] = [];
        for (let c = 1; c <= colCount; c++) {
          let val: unknown = row.getCell(c).value;
          // 수식 셀은 결괏값 사용
          if (val !== null && typeof val === "object" && "result" in val) {
            val = (val as ExcelJS.CellFormulaValue).result ?? null;
          }
          // 서식 있는 텍스트(RichText) → 단순 문자열
          if (val !== null && typeof val === "object" && "richText" in val) {
            val = (val as ExcelJS.CellRichTextValue).richText.map((rt) => rt.text).join("");
          }
          if (val === null || val === undefined) val = opts.defval ?? null;
          rowData.push(val);
        }
        rows.push(rowData);
      });
    }
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError("엑셀 파일을 읽지 못했습니다 (손상되었거나 암호가 걸린 파일).");
  }
  assertRowLimit(Math.max(0, rows.length - (opts.headerRows ?? 1)));
  return rows;
}

// 유지관리 대상/금액 엑셀 파서/직렬화 (import·export·seed·test 공용, 순수 모듈)
import * as XLSX from "xlsx";

export interface ParsedTarget {
  system_name: string;
  category: string;
  asset_type_label: string;
  resource_name: string;
  quantity: number;
  manufacturer: string;
  host_name: string;
  purpose: string;
  location_text: string;
  rack_position: string;
  asset_code: string;
  owner_department: string;
  owner_user: string;
  acquisition_date: string;
  acquisition_amount: string;
  maintenance_start: string;
  maintenance_end: string;
  maintenance_months: number;
  business_impact: string;
  data_importance: string;
  user_traffic: string;
  hardware_score: string;
  maintenance_difficulty: string;
  maintenance_scope: string;
  score_total: string;
  grade: string;
  rate: string;
  estimated_amount_calc: string;
  estimated_amount_input: string;
  evidence_note: string;
  notes: string;
}

// 내보내기 헤더(엑셀 원본 순서). 임포트 라벨 매핑도 이 라벨을 기준으로 한다.
export const TARGET_HEADERS: [string, keyof ParsedTarget | "__loc0" | "__loc1" | "__loc2"][] = [
  ["정보시스템명", "system_name"],
  ["구분", "category"],
  ["유형", "asset_type_label"],
  ["정보자원명", "resource_name"],
  ["수량", "quantity"],
  ["제조사", "manufacturer"],
  ["호스트명", "host_name"],
  ["용도", "purpose"],
  ["지역(동)", "__loc0"],
  ["건물명", "__loc1"],
  ["층", "__loc2"],
  ["랙위치", "rack_position"],
  ["자산코드", "asset_code"],
  ["자산사용부서", "owner_department"],
  ["자산사용자", "owner_user"],
  ["취득일자", "acquisition_date"],
  ["도입금액", "acquisition_amount"],
  ["유지보수시작", "maintenance_start"],
  ["유지보수종료", "maintenance_end"],
  ["기간", "maintenance_months"],
  ["업무영향범위", "business_impact"],
  ["데이터중요도", "data_importance"],
  ["이용자수/처리건수", "user_traffic"],
  ["H/W", "hardware_score"],
  ["유지보수난이도", "maintenance_difficulty"],
  ["유지보수항목", "maintenance_scope"],
  ["측정점수", "score_total"],
  ["유지관리등급", "grade"],
  ["유지관리요율", "rate"],
  ["추정금액(계산)", "estimated_amount_calc"],
  ["추정금액(입력)", "estimated_amount_input"],
  ["근거자료", "evidence_note"],
  ["비고", "notes"],
];

const DATE_FIELDS = new Set<keyof ParsedTarget>(["acquisition_date", "maintenance_start", "maintenance_end"]);
const INT_FIELDS = new Set<keyof ParsedTarget>(["quantity", "maintenance_months"]);

const normLabel = (s: unknown) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// 엑셀 셀 → 텍스트. Date는 YYYY-MM-DD, 숫자는 소수점 없이 문자열화.
export function cellToText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : String(v);
  }
  return String(v).trim();
}

function toInt(v: unknown, fallback: number): number {
  const n = Number(cellToText(v).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function emptyTarget(): ParsedTarget {
  return {
    system_name: "", category: "", asset_type_label: "", resource_name: "",
    quantity: 1, manufacturer: "", host_name: "", purpose: "",
    location_text: "", rack_position: "", asset_code: "",
    owner_department: "", owner_user: "", acquisition_date: "", acquisition_amount: "",
    maintenance_start: "", maintenance_end: "", maintenance_months: 0,
    business_impact: "", data_importance: "", user_traffic: "", hardware_score: "",
    maintenance_difficulty: "", maintenance_scope: "", score_total: "",
    grade: "", rate: "", estimated_amount_calc: "", estimated_amount_input: "",
    evidence_note: "", notes: "",
  };
}

/**
 * 헤더 행에서 라벨→열 인덱스 맵을 만든다. 빈/미지의 라벨은 무시.
 * 반환: { fieldMap: field→colIdx, loc: [c0,c1,c2] }
 */
function buildColumnMap(headerRow: unknown[]) {
  const labelToCol = new Map<string, number>();
  headerRow.forEach((h, i) => {
    const key = normLabel(h);
    if (key && !labelToCol.has(key)) labelToCol.set(key, i);
  });
  const fieldMap: Partial<Record<keyof ParsedTarget, number>> = {};
  const loc: [number, number, number] = [-1, -1, -1];
  for (const [label, target] of TARGET_HEADERS) {
    const col = labelToCol.get(normLabel(label));
    if (col == null) continue;
    if (target === "__loc0") loc[0] = col;
    else if (target === "__loc1") loc[1] = col;
    else if (target === "__loc2") loc[2] = col;
    else fieldMap[target] = col;
  }
  return { fieldMap, loc };
}

function joinLocation(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(" / ");
}

/** 시트(aoa, header:1)의 행 배열을 ParsedTarget[]로 변환. 완전 빈 행/핵심 식별자 없는 행은 제외. */
export function parseTargetRows(rows: unknown[][]): { targets: ParsedTarget[]; skipped: number } {
  if (rows.length < 2) return { targets: [], skipped: 0 };
  const header = rows[0] as unknown[];
  const { fieldMap, loc } = buildColumnMap(header);
  const targets: ParsedTarget[] = [];
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (!row || row.every((c) => cellToText(c) === "")) continue;

    const t = emptyTarget();
    for (const [field, col] of Object.entries(fieldMap) as [keyof ParsedTarget, number][]) {
      const raw = row[col];
      if (INT_FIELDS.has(field)) {
        (t[field] as number) = field === "quantity" ? Math.max(1, toInt(raw, 1)) : Math.max(0, toInt(raw, 0));
      } else if (DATE_FIELDS.has(field)) {
        (t[field] as string) = cellToText(raw);
      } else {
        (t[field] as string) = cellToText(raw);
      }
    }
    t.location_text = joinLocation([
      loc[0] >= 0 ? cellToText(row[loc[0]]) : "",
      loc[1] >= 0 ? cellToText(row[loc[1]]) : "",
      loc[2] >= 0 ? cellToText(row[loc[2]]) : "",
    ]);

    // 핵심 식별자 없는 행(정보자원명·자산코드·시스템명 전부 공란)은 스킵
    if (!t.resource_name && !t.asset_code && !t.system_name) {
      skipped++;
      continue;
    }
    targets.push(t);
  }
  return { targets, skipped };
}

/** .xlsx 버퍼 → ParsedTarget[] */
export function parseTargetWorkbook(buffer: Buffer): { targets: ParsedTarget[]; skipped: number } {
  const wb = XLSX.read(buffer, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { targets: [], skipped: 0 };
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  return parseTargetRows(rows);
}

/** target 레코드 배열 → 엑셀 버퍼(내보내기). 입력은 DB row(문자열/숫자 혼재 허용). */
export function buildTargetWorkbook(records: Record<string, unknown>[]): Buffer {
  const headers = TARGET_HEADERS.map(([label]) => label);
  const aoa: unknown[][] = [headers];
  for (const rec of records) {
    const locParts = String(rec.location_text ?? "").split("/").map((s) => s.trim());
    const row: unknown[] = [];
    for (const [, field] of TARGET_HEADERS) {
      if (field === "__loc0") row.push(locParts[0] ?? "");
      else if (field === "__loc1") row.push(locParts[1] ?? "");
      else if (field === "__loc2") row.push(locParts[2] ?? "");
      else row.push(rec[field] ?? "");
    }
    aoa.push(row);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = headers.map((h) => ({ wch: Math.min(Math.max(h.length * 2, 10), 40) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "유지관리대상");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// INSERT 컬럼 순서(라우트·시드 공용)
export const TARGET_INSERT_COLUMNS: (keyof ParsedTarget)[] = [
  "system_name", "category", "asset_type_label", "resource_name", "quantity",
  "manufacturer", "host_name", "purpose", "location_text", "rack_position",
  "asset_code", "owner_department", "owner_user", "acquisition_date", "acquisition_amount",
  "maintenance_start", "maintenance_end", "maintenance_months", "business_impact",
  "data_importance", "user_traffic", "hardware_score", "maintenance_difficulty",
  "maintenance_scope", "score_total", "grade", "rate", "estimated_amount_calc",
  "estimated_amount_input", "evidence_note", "notes",
];

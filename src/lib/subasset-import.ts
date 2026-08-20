// 부속자산 엑셀 파서/직렬화 (import·export·test 공용, 순수 모듈 — DB/프레임워크 의존 없음).
// 자산(assets)의 대량 업로드/다운로드와 동일한 UX를 부속자산에 제공한다.
import * as XLSX from "xlsx";

export interface ParsedSubAsset {
  asset_code: string;
  category_major: string;
  category_mid: string;
  category_minor: string;
  sub_name: string;
  spec: string;
  serial_number: string;
  acquired_date: string;
  user_name: string;
  place: string;
  purpose: string;
  note: string;
  status: "active" | "disposed";
  // 아래 둘은 라우트에서 id로 해석(직접 INSERT 컬럼 아님) — 상위장비명/관리부서명 스냅샷.
  parent_name: string;
  team_name: string;
}

// 내보내기 헤더(엑셀 컬럼 순서). 임포트 라벨 매핑도 이 라벨을 기준으로 한다.
export const SUBASSET_HEADERS: [string, keyof ParsedSubAsset][] = [
  ["자산코드", "asset_code"],
  ["대분류", "category_major"],
  ["중분류", "category_mid"],
  ["소분류", "category_minor"],
  ["자산명", "sub_name"],
  ["규격", "spec"],
  ["시리얼번호", "serial_number"],
  ["취득일", "acquired_date"],
  ["사용자", "user_name"],
  ["설치장소", "place"],
  ["용도", "purpose"],
  ["비고", "note"],
  ["상태", "status"],
  ["상위장비", "parent_name"],
  ["관리부서", "team_name"],
];

// DB INSERT 컬럼(라우트 공용) — parent_asset_id/team_id 는 라우트가 이름으로 해석해 별도 주입.
export const SUBASSET_INSERT_COLUMNS: (keyof ParsedSubAsset)[] = [
  "asset_code", "category_major", "category_mid", "category_minor", "sub_name",
  "spec", "serial_number", "acquired_date", "user_name", "place", "purpose", "note", "status",
];

const normLabel = (s: unknown) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// 엑셀 셀 → 텍스트. Date는 YYYY-MM-DD, 숫자는 문자열화, 앞뒤 공백 제거.
export function cellToText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  if (typeof v === "number") return String(v);
  return String(v).trim();
}

/** 상태 라벨 정규화 — '폐기'/'disposed' 만 disposed, 그 외(공란 포함)는 active. */
export function parseStatus(v: unknown): "active" | "disposed" {
  const s = normLabel(v);
  return s === "폐기" || s === "disposed" ? "disposed" : "active";
}

/** 상태 → 사람이 읽는 라벨(내보내기용). */
export function statusLabel(status: string): string {
  return status === "disposed" ? "폐기" : "운용중";
}

function emptySub(): ParsedSubAsset {
  return {
    asset_code: "", category_major: "", category_mid: "", category_minor: "",
    sub_name: "", spec: "", serial_number: "", acquired_date: "", user_name: "",
    place: "", purpose: "", note: "", status: "active", parent_name: "", team_name: "",
  };
}

/** 헤더 행에서 라벨→열 인덱스 맵. 빈/미지 라벨은 무시. */
function buildColumnMap(headerRow: unknown[]): Partial<Record<keyof ParsedSubAsset, number>> {
  const labelToCol = new Map<string, number>();
  headerRow.forEach((h, i) => {
    const key = normLabel(h);
    if (key && !labelToCol.has(key)) labelToCol.set(key, i);
  });
  const fieldMap: Partial<Record<keyof ParsedSubAsset, number>> = {};
  for (const [label, field] of SUBASSET_HEADERS) {
    const col = labelToCol.get(normLabel(label));
    if (col != null) fieldMap[field] = col;
  }
  return fieldMap;
}

/** 시트(aoa, header:1) → ParsedSubAsset[]. 완전 빈 행/자산명·자산코드 모두 공란인 행은 제외. */
export function parseSubAssetRows(rows: unknown[][]): { subs: ParsedSubAsset[]; skipped: number } {
  if (rows.length < 2) return { subs: [], skipped: 0 };
  const fieldMap = buildColumnMap(rows[0] as unknown[]);
  const subs: ParsedSubAsset[] = [];
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    if (!row || row.every((c) => cellToText(c) === "")) continue;

    const s = emptySub();
    for (const [field, col] of Object.entries(fieldMap) as [keyof ParsedSubAsset, number][]) {
      if (field === "status") s.status = parseStatus(row[col]);
      else (s[field] as string) = cellToText(row[col]);
    }

    // 핵심 식별자(자산명·자산코드) 둘 다 공란이면 스킵
    if (!s.sub_name && !s.asset_code) {
      skipped++;
      continue;
    }
    subs.push(s);
  }
  return { subs, skipped };
}

/** .xlsx 버퍼 → ParsedSubAsset[] */
export function parseSubAssetWorkbook(buffer: Buffer): { subs: ParsedSubAsset[]; skipped: number } {
  const wb = XLSX.read(buffer, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { subs: [], skipped: 0 };
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  return parseSubAssetRows(rows);
}

/** 부속자산 레코드 배열 → 엑셀 버퍼(내보내기). 입력은 DB row(parent_name/team_name JOIN 포함). */
export function buildSubAssetWorkbook(records: Record<string, unknown>[]): Buffer {
  const headers = SUBASSET_HEADERS.map(([label]) => label);
  const aoa: unknown[][] = [headers];
  for (const rec of records) {
    const row: unknown[] = SUBASSET_HEADERS.map(([, field]) => {
      if (field === "status") return statusLabel(String(rec.status ?? "active"));
      return rec[field] ?? "";
    });
    aoa.push(row);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = headers.map((h) => ({ wch: Math.min(Math.max(h.length * 2, 10), 40) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "부속자산");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

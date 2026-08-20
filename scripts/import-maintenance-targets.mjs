// 유지관리 대상/금액 엑셀 → data.db 시드 (일회성).
// 사용: node scripts/import-maintenance-targets.mjs "260707_정보시스템 유지관리 대상 및 금액.xlsx" [--replace]
// 컬럼 매핑은 src/lib/maintenance-target-import.ts 와 동일 규칙을 유지한다.
import Database from "better-sqlite3";
import * as XLSX from "xlsx";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const xlsxPath = args.find((a) => !a.startsWith("--")) || "260707_정보시스템 유지관리 대상 및 금액.xlsx";
const dbPath = process.env.ASSET_DB_PATH ? path.resolve(process.env.ASSET_DB_PATH) : path.join(process.cwd(), "data.db");

const HEADERS = [
  ["정보시스템명", "system_name"], ["구분", "category"], ["유형", "asset_type_label"],
  ["정보자원명", "resource_name"], ["수량", "quantity"], ["제조사", "manufacturer"],
  ["호스트명", "host_name"], ["용도", "purpose"], ["지역(동)", "__loc0"], ["건물명", "__loc1"],
  ["층", "__loc2"], ["랙위치", "rack_position"], ["자산코드", "asset_code"],
  ["자산사용부서", "owner_department"], ["자산사용자", "owner_user"], ["취득일자", "acquisition_date"],
  ["도입금액", "acquisition_amount"], ["유지보수시작", "maintenance_start"], ["유지보수종료", "maintenance_end"],
  ["기간", "maintenance_months"], ["업무영향범위", "business_impact"], ["데이터중요도", "data_importance"],
  ["이용자수/처리건수", "user_traffic"], ["H/W", "hardware_score"], ["유지보수난이도", "maintenance_difficulty"],
  ["유지보수항목", "maintenance_scope"], ["측정점수", "score_total"], ["유지관리등급", "grade"],
  ["유지관리요율", "rate"], ["추정금액(계산)", "estimated_amount_calc"], ["추정금액(입력)", "estimated_amount_input"],
  ["근거자료", "evidence_note"], ["비고", "notes"],
];
const DATE_FIELDS = new Set(["acquisition_date", "maintenance_start", "maintenance_end"]);
const INT_FIELDS = new Set(["quantity", "maintenance_months"]);
const norm = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();
const pad2 = (n) => String(n).padStart(2, "0");
function cellToText(v) {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  if (typeof v === "number") return String(v);
  return String(v).trim();
}
function toInt(v, fb) {
  const n = Number(cellToText(v).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : fb;
}

const wb = XLSX.read(await import("node:fs").then((fs) => fs.readFileSync(xlsxPath)), { cellDates: true });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
const header = rows[0] || [];
const labelToCol = new Map();
header.forEach((h, i) => { const k = norm(h); if (k && !labelToCol.has(k)) labelToCol.set(k, i); });
const fieldMap = {};
const loc = [-1, -1, -1];
for (const [label, field] of HEADERS) {
  const col = labelToCol.get(norm(label));
  if (col == null) continue;
  if (field === "__loc0") loc[0] = col;
  else if (field === "__loc1") loc[1] = col;
  else if (field === "__loc2") loc[2] = col;
  else fieldMap[field] = col;
}

const FIELDS = HEADERS.map(([, f]) => f).filter((f) => !f.startsWith("__"));
const targets = [];
let skipped = 0;
for (let r = 1; r < rows.length; r++) {
  const row = rows[r] || [];
  if (row.every((c) => cellToText(c) === "")) continue;
  const t = {};
  for (const f of FIELDS) {
    const col = fieldMap[f];
    const raw = col == null ? "" : row[col];
    if (INT_FIELDS.has(f)) t[f] = f === "quantity" ? Math.max(1, toInt(raw, 1)) : Math.max(0, toInt(raw, 0));
    else t[f] = cellToText(raw);
  }
  t.location_text = [loc[0] >= 0 ? cellToText(row[loc[0]]) : "", loc[1] >= 0 ? cellToText(row[loc[1]]) : "", loc[2] >= 0 ? cellToText(row[loc[2]]) : ""]
    .map((s) => s.trim()).filter(Boolean).join(" / ");
  if (!t.resource_name && !t.asset_code && !t.system_name) { skipped++; continue; }
  targets.push(t);
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
const cols = [...FIELDS, "location_text", "asset_id", "asset_name", "created_by", "updated_by"];
const insert = db.prepare(`INSERT INTO maintenance_targets (${cols.join(",")}) VALUES (${cols.map((c) => "@" + c).join(",")})`);
const findAsset = db.prepare("SELECT id, asset_name FROM assets WHERE asset_tag = ? AND asset_tag != ''");
let inserted = 0;
const tx = db.transaction(() => {
  if (replace) db.exec("DELETE FROM maintenance_targets");
  for (const t of targets) {
    const m = t.asset_code ? findAsset.get(t.asset_code) : undefined;
    insert.run({ ...t, asset_id: m ? m.id : null, asset_name: m ? m.asset_name : "", created_by: "seed", updated_by: "seed" });
    inserted++;
  }
});
tx();
console.log(`[seed] ${inserted}건 등록, ${skipped}건 스킵 (replace=${replace}) → ${dbPath}`);

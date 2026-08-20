// 자산 일괄 적재 스크립트 — import 라우트(src/app/api/assets/import/route.ts) 로직과 동일
// 사용: node scripts/import-assets.mjs "<xlsx 경로>" [--by=loader]
import { createRequire } from "module";
import path from "path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const XLSX = require("xlsx");

const FILE = process.argv[2];
if (!FILE) { console.error("xlsx 경로를 인자로 주세요."); process.exit(1); }
const CHANGED_BY = (process.argv.find((a) => a.startsWith("--by=")) || "--by=import-script").split("=")[1];

const VALID_TYPES = ["server", "network", "security", "telecom", "vm", "other"];
const VALID_STATUSES = ["active", "maintenance", "standby", "retired"];
const FIXED_KEYS = [
  "asset_type", "asset_name", "manufacturer", "model", "serial_number",
  "ip_address", "asset_tag", "status", "os", "access_ip",
  "user_name", "admin_name", "department",
  "rack_name", "rack_unit_start", "rack_unit_size", "description",
  "network_zone", "cia_c", "cia_i", "cia_a",
];
const FIXED_LABELS = [
  "유형", "이름", "제조사", "모델", "시리얼번호",
  "IP주소", "자산태그", "상태", "OS", "접근IP",
  "사용자", "관리자", "부서",
  "랙이름", "시작U", "크기U", "설명",
  "망구분", "기밀성", "무결성", "가용성",
];
const normLabel = (s) => String(s ?? "").replace(/\s+/g, "");
const LABEL_ALIASES = {
  "망구분": "network_zone", "망": "network_zone", "망분류": "network_zone",
  "기밀성": "cia_c", "기밀성c": "cia_c", "c": "cia_c",
  "무결성": "cia_i", "무결성i": "cia_i", "i": "cia_i",
  "가용성": "cia_a", "가용성a": "cia_a", "a": "cia_a",
};
function normalizeZone(v) {
  const s = String(v ?? "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.includes("업무")) return "업무망";
  if (s.includes("인터넷") || s.includes("외부") || /dmz/i.test(s)) return "인터넷망";
  return "";
}

const db = new Database(path.join(process.cwd(), "data.db"));
db.pragma("foreign_keys = ON");

const wb = XLSX.read(Buffer.from(require("fs").readFileSync(FILE)));
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
if (rows.length < 2) { console.error("데이터 행 없음"); process.exit(1); }

const headerRow = rows[0] || [];
const secondRow = rows[1] || [];
const colMap = {};
const customFieldCols = [];
const hasKeyRow = secondRow.some((c) => {
  const s = String(c ?? "").trim();
  return FIXED_KEYS.includes(s) || s.startsWith("cf:");
});

let dataRows;
if (hasKeyRow) {
  for (let c = 0; c < secondRow.length; c++) {
    const key = String(secondRow[c] || "").trim();
    if (key.startsWith("cf:")) {
      const fieldId = parseInt(key.substring(3), 10);
      if (!isNaN(fieldId)) customFieldCols.push({ colIdx: c, fieldId, label: String(headerRow[c] || `필드${fieldId}`) });
    } else if (key) colMap[key] = c;
  }
  dataRows = rows.slice(2).filter((r) => r.some((c) => c !== undefined && c !== ""));
} else {
  const labelToKey = {};
  FIXED_LABELS.forEach((label, i) => { labelToKey[label] = FIXED_KEYS[i]; });
  const cfRows = db.prepare("SELECT id, field_label FROM custom_fields WHERE is_active = 1").all();
  const cfByLabel = new Map(cfRows.map((f) => [String(f.field_label).trim(), f.id]));
  const cfByNorm = new Map(cfRows.map((f) => [normLabel(f.field_label).toLowerCase(), f.id]));
  for (let c = 0; c < headerRow.length; c++) {
    const label = String(headerRow[c] ?? "").trim();
    if (!label) continue;
    const nk = normLabel(label).toLowerCase();
    if (labelToKey[label] !== undefined) colMap[labelToKey[label]] = c;
    else if (LABEL_ALIASES[nk] !== undefined) colMap[LABEL_ALIASES[nk]] = c;
    else if (cfByLabel.has(label)) customFieldCols.push({ colIdx: c, fieldId: cfByLabel.get(label), label });
    else if (cfByNorm.has(nk)) customFieldCols.push({ colIdx: c, fieldId: cfByNorm.get(nk), label });
  }
  dataRows = rows.slice(1).filter((r) => r.some((c) => c !== undefined && c !== ""));
}

const getVal = (r, k) => {
  const i = colMap[k];
  if (i === undefined) return "";
  const v = r[i];
  return v !== undefined && v !== null ? String(v).trim() : "";
};

const allRacks = db.prepare("SELECT id, rack_name FROM racks").all();
const rackMap = new Map(allRacks.map((r) => [r.rack_name, r.id]));
const validFieldIds = new Set(db.prepare("SELECT id FROM custom_fields WHERE is_active = 1").all().map((f) => f.id));
const fieldTypes = new Map(db.prepare("SELECT id, field_type FROM custom_fields").all().map((f) => [f.id, f.field_type]));

const errors = [];
const validRows = [];
for (let i = 0; i < dataRows.length; i++) {
  const r = dataRows[i];
  const rowErr = [];
  const name = getVal(r, "asset_name");
  if (!name) rowErr.push("이름 필수");
  const asset_type = (getVal(r, "asset_type") || "server").toLowerCase();
  if (!VALID_TYPES.includes(asset_type)) rowErr.push(`유형:${asset_type}`);
  const status = (getVal(r, "status") || "active").toLowerCase();
  if (!VALID_STATUSES.includes(status)) rowErr.push(`상태:${status}`);

  let rack_unit_start = null;
  const startRaw = getVal(r, "rack_unit_start");
  if (startRaw) { const n = Number(startRaw); if (Number.isInteger(n) && n >= 1) rack_unit_start = n; else rowErr.push("시작U"); }
  let rack_unit_size = 1;
  const sizeRaw = getVal(r, "rack_unit_size");
  if (sizeRaw) { const n = Number(sizeRaw); if (Number.isInteger(n) && n >= 1) rack_unit_size = n; else rowErr.push("크기U"); }
  let rack_id = null;
  const rackName = getVal(r, "rack_name");
  if (rackName) { const f = rackMap.get(rackName); if (f === undefined) rowErr.push(`랙없음:${rackName}`); else rack_id = f; }

  const network_zone = normalizeZone(getVal(r, "network_zone"));
  const parseCia = (k) => { const raw = getVal(r, k); if (!raw) return null; const n = Number(raw); if (!Number.isInteger(n) || n < 1 || n > 3) { rowErr.push(`${k}:${raw}`); return null; } return n; };
  const cia_c = parseCia("cia_c"), cia_i = parseCia("cia_i"), cia_a = parseCia("cia_a");

  const cvs = [];
  for (const cf of customFieldCols) {
    if (!validFieldIds.has(cf.fieldId)) continue;
    const val = r[cf.colIdx];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      let fv = String(val).trim();
      if (fieldTypes.get(cf.fieldId) === "multi-text" && fv.includes("|")) fv = JSON.stringify(fv.split("|").map((s) => s.trim()).filter(Boolean));
      cvs.push({ fieldId: cf.fieldId, value: fv });
    }
  }

  if (rowErr.length) errors.push({ row: i + (hasKeyRow ? 3 : 2), err: rowErr.join(", ") });
  else validRows.push({ asset: { asset_type, asset_name: name, manufacturer: getVal(r, "manufacturer"), model: getVal(r, "model"), serial_number: getVal(r, "serial_number"), ip_address: getVal(r, "ip_address"), asset_tag: getVal(r, "asset_tag"), status, os: getVal(r, "os"), access_ip: getVal(r, "access_ip"), user_name: getVal(r, "user_name"), admin_name: getVal(r, "admin_name"), department: getVal(r, "department"), network_zone, cia_c, cia_i, cia_a, rack_id, rack_unit_start, rack_unit_size, description: getVal(r, "description") }, customValues: cvs });
}

const assetStmt = db.prepare(`
  INSERT INTO assets (asset_type, asset_name, manufacturer, model, serial_number, ip_address, asset_tag,
    status, os, access_ip, user_name, admin_name, department, network_zone, cia_c, cia_i, cia_a,
    rack_id, rack_unit_start, rack_unit_size, description)
  VALUES (@asset_type, @asset_name, @manufacturer, @model, @serial_number, @ip_address, @asset_tag,
    @status, @os, @access_ip, @user_name, @admin_name, @department, @network_zone, @cia_c, @cia_i, @cia_a,
    @rack_id, @rack_unit_start, @rack_unit_size, @description)`);
const cvStmt = db.prepare("INSERT INTO custom_values (asset_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT(asset_id, field_id) DO UPDATE SET value = excluded.value");
const auditStmt = db.prepare(`INSERT INTO audit_logs (entity_type, entity_id, entity_name, action, changed_by, changed_fields, old_values, new_values) VALUES ('asset', ?, ?, 'create', ?, ?, '{}', ?)`);

const run = db.transaction(() => {
  for (const { asset, customValues } of validRows) {
    const res = assetStmt.run(asset);
    const id = res.lastInsertRowid;
    for (const cv of customValues) cvStmt.run(id, cv.fieldId, cv.value);
    auditStmt.run(Number(id), asset.asset_name, CHANGED_BY, JSON.stringify(Object.keys(asset)), JSON.stringify(asset));
  }
});
run();

console.log(`매핑: 고정 ${Object.keys(colMap).length}개, 커스텀 ${customFieldCols.length}개 (키행=${hasKeyRow})`);
console.log(`적재: ${validRows.length}건 / 오류: ${errors.length}건 / 데이터행: ${dataRows.length}`);
if (errors.length) console.log("오류 샘플:", errors.slice(0, 10));
console.log("현재 assets 총계:", db.prepare("SELECT COUNT(*) n FROM assets").get().n);

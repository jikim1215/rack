import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { logAssetChange } from "@/lib/audit";
import { getSession } from "@/lib/auth";


const VALID_TYPES = ["server", "network", "security", "telecom", "other"];
const VALID_STATUSES = ["active", "inactive", "maintenance", "decommissioned", "eos"];

// 고정 필드 인덱스 (키 행 기반)
const FIXED_KEYS = [
  "asset_type", "asset_name", "manufacturer", "model", "serial_number",
  "ip_address", "asset_tag", "status", "os", "access_ip",
  "user_name", "admin_name", "department",
  "rack_name", "rack_unit_start", "rack_unit_size", "description",
];

interface ImportError {
  row: number;
  column: string;
  value: string;
  error: string;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buffer);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1 });

  if (rows.length < 3) {
    return NextResponse.json({
      success: false, imported: 0, totalRows: 0,
      errors: [{ row: 0, column: "", value: "", error: "데이터 행이 없습니다. (헤더 + 키매핑 + 데이터 필요)" }],
    });
  }

  const db = getDb();
  const headerRow = rows[0] as string[];
  const keyRow = rows[1] as string[];
  const dataRows = rows.slice(2).filter((r: any[]) => r.some((c) => c !== undefined && c !== ""));

  if (dataRows.length === 0) {
    return NextResponse.json({
      success: false, imported: 0, totalRows: 0,
      errors: [{ row: 0, column: "", value: "", error: "데이터 행이 없습니다." }],
    });
  }

  // 키 행에서 컬럼 매핑 구축
  const colMap: Record<string, number> = {};
  const customFieldCols: { colIdx: number; fieldId: number; label: string }[] = [];

  for (let c = 0; c < keyRow.length; c++) {
    const key = String(keyRow[c] || "").trim();
    if (key.startsWith("cf:")) {
      const fieldId = parseInt(key.substring(3), 10);
      if (!isNaN(fieldId)) {
        customFieldCols.push({ colIdx: c, fieldId, label: String(headerRow[c] || `필드${fieldId}`) });
      }
    } else if (key) {
      colMap[key] = c;
    }
  }

  // 만약 키 행이 없는 경우 (구버전 양식) — 순서 기반 폴백
  if (Object.keys(colMap).length === 0) {
    for (let c = 0; c < FIXED_KEYS.length && c < headerRow.length; c++) {
      colMap[FIXED_KEYS[c]] = c;
    }
  }

  function getVal(row: any[], key: string): string {
    const idx = colMap[key];
    if (idx === undefined) return "";
    const v = row[idx];
    return v !== undefined && v !== null ? String(v).trim() : "";
  }

  // 랙 매핑
  const allRacks = db.prepare("SELECT id, rack_name FROM racks").all() as any[];
  const rackMap = new Map(allRacks.map((r: any) => [r.rack_name, r.id]));

  // 커스텀 필드 유효성 확인
  const validFieldIds = new Set(
    (db.prepare("SELECT id FROM custom_fields WHERE is_active = 1").all() as any[]).map((f: any) => f.id)
  );

  const errors: ImportError[] = [];
  const validRows: any[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNum = i + 3; // 1-indexed + header + keyrow
    const rowErrors: ImportError[] = [];

    const name = getVal(r, "asset_name");
    if (!name) {
      rowErrors.push({ row: rowNum, column: "이름", value: "", error: "이름은 필수입니다" });
    }

    const asset_type = (getVal(r, "asset_type") || "server").toLowerCase();
    if (!VALID_TYPES.includes(asset_type)) {
      rowErrors.push({ row: rowNum, column: "유형", value: asset_type, error: `유효하지 않은 유형. 허용: ${VALID_TYPES.join(", ")}` });
    }

    const status = (getVal(r, "status") || "active").toLowerCase();
    if (!VALID_STATUSES.includes(status)) {
      rowErrors.push({ row: rowNum, column: "상태", value: status, error: `유효하지 않은 상태. 허용: ${VALID_STATUSES.join(", ")}` });
    }

    let rack_unit_start: number | null = null;
    const startRaw = getVal(r, "rack_unit_start");
    if (startRaw) {
      const n = Number(startRaw);
      if (isNaN(n) || !Number.isInteger(n) || n < 1) {
        rowErrors.push({ row: rowNum, column: "시작U", value: startRaw, error: "양의 정수여야 합니다" });
      } else {
        rack_unit_start = n;
      }
    }

    let rack_unit_size = 1;
    const sizeRaw = getVal(r, "rack_unit_size");
    if (sizeRaw) {
      const n = Number(sizeRaw);
      if (isNaN(n) || !Number.isInteger(n) || n < 1) {
        rowErrors.push({ row: rowNum, column: "크기U", value: sizeRaw, error: "양의 정수여야 합니다" });
      } else {
        rack_unit_size = n;
      }
    }

    let rack_id: number | null = null;
    const rackName = getVal(r, "rack_name");
    if (rackName) {
      const found = rackMap.get(rackName);
      if (found === undefined) {
        rowErrors.push({ row: rowNum, column: "랙이름", value: rackName, error: `랙 '${rackName}'을(를) 찾을 수 없습니다` });
      } else {
        rack_id = found;
      }
    }

    // 커스텀 필드 값 수집 (multi-text는 파이프 구분 → JSON 배열 변환)
    const customValuesForRow: { fieldId: number; value: string }[] = [];
    for (const cf of customFieldCols) {
      if (!validFieldIds.has(cf.fieldId)) continue;
      const val = r[cf.colIdx];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        let finalVal = String(val).trim();
        // multi-text 타입: 파이프(|) 구분 → JSON 배열
        const fieldDef = db.prepare("SELECT field_type FROM custom_fields WHERE id = ?").get(cf.fieldId) as any;
        if (fieldDef?.field_type === "multi-text" && finalVal.includes("|")) {
          finalVal = JSON.stringify(finalVal.split("|").map((s: string) => s.trim()).filter(Boolean));
        }
        customValuesForRow.push({ fieldId: cf.fieldId, value: finalVal });
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      validRows.push({
        asset: {
          asset_type, asset_name: name, manufacturer: getVal(r, "manufacturer"), model: getVal(r, "model"),
          serial_number: getVal(r, "serial_number"), ip_address: getVal(r, "ip_address"),
          asset_tag: getVal(r, "asset_tag"), status,
          os: getVal(r, "os"), access_ip: getVal(r, "access_ip"),
          user_name: getVal(r, "user_name"), admin_name: getVal(r, "admin_name"),
          department: getVal(r, "department"), rack_id, rack_unit_start, rack_unit_size,
          description: getVal(r, "description"),
        },
        customValues: customValuesForRow,
      });
    }
  }

  // 트랜잭션으로 일괄 INSERT

  const insertAll = db.transaction(() => {
    const assetStmt = db.prepare(`
      INSERT INTO assets (asset_type, asset_name, manufacturer, model, serial_number, ip_address, asset_tag,
        status, os, access_ip, user_name, admin_name, department,
        rack_id, rack_unit_start, rack_unit_size, description)
      VALUES (@asset_type, @asset_name, @manufacturer, @model, @serial_number, @ip_address, @asset_tag,
        @status, @os, @access_ip, @user_name, @admin_name, @department,
        @rack_id, @rack_unit_start, @rack_unit_size, @description)
    `);
    const cvStmt = db.prepare(
      "INSERT INTO custom_values (asset_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT(asset_id, field_id) DO UPDATE SET value = excluded.value"
    );

    for (const { asset, customValues } of validRows) {
      const result = assetStmt.run(asset);
      const assetId = result.lastInsertRowid;
      for (const cv of customValues) {
        cvStmt.run(assetId, cv.fieldId, cv.value);
      }
      logAssetChange(db, {
        assetId: Number(assetId),
        assetName: asset.asset_name,
        action: 'create',
        changedBy: session?.username || 'system',
        newData: asset,
      });
    }
  });

  insertAll();

  return NextResponse.json({
    success: errors.length === 0,
    imported: validRows.length,
    totalRows: dataRows.length,
    errors,
  });
}

import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

const VALID_TYPES = ["server", "network", "security", "storage", "other"];
const VALID_STATUSES = ["active", "inactive", "maintenance", "decommissioned", "eos"];

interface ImportError {
  row: number;
  column: string;
  value: string;
  error: string;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buffer);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1 });

  if (rows.length < 2) {
    return NextResponse.json(
      { success: false, imported: 0, totalRows: 0, errors: [{ row: 0, column: "", value: "", error: "No data rows" }] }
    );
  }

  // Skip header row
  const dataRows = rows.slice(1).filter((r: any[]) => r.some((c) => c !== undefined && c !== ""));
  const db = getDb();
  const errors: ImportError[] = [];
  const validRows: any[] = [];

  // Pre-fetch rack mapping
  const allRacks = db.prepare("SELECT id, name FROM racks").all() as { id: number; name: string }[];
  const rackMap = new Map(allRacks.map((r) => [r.name, r.id]));

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNum = i + 2; // 1-indexed + header
    const rowErrors: ImportError[] = [];

    const [
      asset_type_raw, name, manufacturer, model, serial_number,
      ip_address, asset_tag, status_raw, os, access_ip,
      user_name, admin_name, department, rack_name,
      rack_unit_start_raw, rack_unit_size_raw,
      purchase_date, warranty_date, eos_date, description,
    ] = r;

    // name 필수
    if (!name || String(name).trim() === "") {
      rowErrors.push({ row: rowNum, column: "이름", value: String(name ?? ""), error: "이름은 필수입니다" });
    }

    // asset_type
    const asset_type = asset_type_raw ? String(asset_type_raw).trim().toLowerCase() : "server";
    if (!VALID_TYPES.includes(asset_type)) {
      rowErrors.push({ row: rowNum, column: "유형", value: String(asset_type_raw), error: `유효하지 않은 유형. 허용: ${VALID_TYPES.join(", ")}` });
    }

    // status
    const status = status_raw ? String(status_raw).trim().toLowerCase() : "active";
    if (!VALID_STATUSES.includes(status)) {
      rowErrors.push({ row: rowNum, column: "상태", value: String(status_raw), error: `유효하지 않은 상태. 허용: ${VALID_STATUSES.join(", ")}` });
    }

    // rack_unit_start
    let rack_unit_start: number | null = null;
    if (rack_unit_start_raw !== undefined && rack_unit_start_raw !== "") {
      const n = Number(rack_unit_start_raw);
      if (isNaN(n) || !Number.isInteger(n) || n < 1) {
        rowErrors.push({ row: rowNum, column: "시작U", value: String(rack_unit_start_raw), error: "시작U는 양의 정수여야 합니다" });
      } else {
        rack_unit_start = n;
      }
    }

    // rack_unit_size
    let rack_unit_size: number = 1;
    if (rack_unit_size_raw !== undefined && rack_unit_size_raw !== "") {
      const n = Number(rack_unit_size_raw);
      if (isNaN(n) || !Number.isInteger(n) || n < 1) {
        rowErrors.push({ row: rowNum, column: "크기U", value: String(rack_unit_size_raw), error: "크기U는 양의 정수여야 합니다" });
      } else {
        rack_unit_size = n;
      }
    }

    // rack 매핑
    let rack_id: number | null = null;
    if (rack_name && String(rack_name).trim() !== "") {
      const rn = String(rack_name).trim();
      const found = rackMap.get(rn);
      if (found === undefined) {
        rowErrors.push({ row: rowNum, column: "랙이름", value: rn, error: `랙 '${rn}'을(를) 찾을 수 없습니다` });
      } else {
        rack_id = found;
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      validRows.push({
        asset_type,
        name: String(name).trim(),
        manufacturer: manufacturer ? String(manufacturer).trim() : "",
        model: model ? String(model).trim() : "",
        serial_number: serial_number ? String(serial_number).trim() : "",
        ip_address: ip_address ? String(ip_address).trim() : "",
        asset_tag: asset_tag ? String(asset_tag).trim() : "",
        status,
        os: os ? String(os).trim() : "",
        access_ip: access_ip ? String(access_ip).trim() : "",
        user_name: user_name ? String(user_name).trim() : "",
        admin_name: admin_name ? String(admin_name).trim() : "",
        department: department ? String(department).trim() : "",
        rack_id,
        rack_unit_start,
        rack_unit_size,
        purchase_date: purchase_date ? String(purchase_date).trim() : "",
        warranty_date: warranty_date ? String(warranty_date).trim() : "",
        eos_date: eos_date ? String(eos_date).trim() : "",
        description: description ? String(description).trim() : "",
      });
    }
  }

  // Insert valid rows in transaction
  const insertRows = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO assets (
        asset_type, name, manufacturer, model, serial_number, ip_address, asset_tag,
        status, os, access_ip, user_name, admin_name, department,
        rack_id, rack_unit_start, rack_unit_size, purchase_date, warranty_date, eos_date, description
      ) VALUES (
        @asset_type, @name, @manufacturer, @model, @serial_number, @ip_address, @asset_tag,
        @status, @os, @access_ip, @user_name, @admin_name, @department,
        @rack_id, @rack_unit_start, @rack_unit_size, @purchase_date, @warranty_date, @eos_date, @description
      )
    `);
    for (const row of validRows) {
      stmt.run(row);
    }
  });

  insertRows();

  return NextResponse.json({
    success: errors.length === 0,
    imported: validRows.length,
    totalRows: dataRows.length,
    errors,
  });
}

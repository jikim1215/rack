import { getDb } from "@/lib/db";
import * as XLSX from "xlsx";

export async function GET() {
  const db = getDb();
  const assets = db.prepare(`
    SELECT a.*, r.name as rack_name, l.name as location_name
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id
    ORDER BY a.id
  `).all() as any[];

  const headers = [
    "ID", "유형", "이름", "제조사", "모델", "시리얼", "IP주소", "자산태그",
    "상태", "OS", "접근IP", "사용자", "관리자", "부서", "위치", "랙이름",
    "시작U", "크기U", "구매일", "보증만료", "EoS일자", "설명", "생성일",
  ];

  const data = assets.map((a) => [
    a.id, a.asset_type, a.name, a.manufacturer, a.model,
    a.serial_number, a.ip_address, a.asset_tag, a.status,
    a.os, a.access_ip, a.user_name, a.admin_name, a.department,
    a.location_name || "", a.rack_name || "",
    a.rack_unit_start ?? "", a.rack_unit_size ?? "",
    a.purchase_date, a.warranty_date, a.eos_date,
    a.description, a.created_at,
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  ws["!cols"] = headers.map((h, i) => {
    const maxLen = Math.max(
      h.length * 2,
      ...data.map((row) => String(row[i] ?? "").length),
      8
    );
    return { wch: Math.min(maxLen + 2, 40) };
  });

  XLSX.utils.book_append_sheet(wb, ws, "자산목록");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=assets-export.xlsx",
    },
  });
}

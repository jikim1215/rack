import { getDb } from "@/lib/db";
import * as XLSX from "xlsx";

/**
 * 자산 양식 다운로드 — 커스텀 필드 동적 반영
 * 기본 고정 컬럼 + 활성 커스텀 필드가 자동으로 헤더에 추가됨
 */
export async function GET() {
  const db = getDb();

  // 활성 커스텀 필드 조회
  const customFields = db.prepare(
    "SELECT id, field_key, field_label, field_type, field_group FROM custom_fields WHERE is_active = 1 ORDER BY field_group, sort_order, id"
  ).all() as any[];

  // 고정 헤더
  const fixedHeaders = [
    "유형", "이름", "제조사", "모델", "시리얼번호", "IP주소", "자산태그",
    "상태", "OS", "접근IP", "사용자", "관리자", "부서",
    "랙이름", "시작U", "크기U", "설명",
  ];

  // 커스텀 필드 헤더 (라벨 + 키 표기)
  const customHeaders = customFields.map((f: any) => `${f.field_label}`);

  const allHeaders = [...fixedHeaders, ...customHeaders];

  // 예시 행
  const fixedExample = [
    "server", "웹서버-01", "Dell", "PowerEdge R740", "SRV-001",
    "10.10.1.11", "SV-001", "active", "Rocky Linux 8.9", "10.10.1.11",
    "", "김정보", "정보운영과", "A-01", "1", "2", "메인 웹서버",
  ];
  const customExample = customFields.map((f: any) => {
    if (f.field_type === "date") return "2024-01-01";
    if (f.field_type === "number") return "0";
    if (f.field_type === "multi-text") return "값1|값2";
    return "";
  });

  // 필드 키 매핑 행 (2번째 행 — import 시 매핑용, 숨김)
  const keyRow = [
    "asset_type", "asset_name", "manufacturer", "model", "serial_number",
    "ip_address", "asset_tag", "status", "os", "access_ip",
    "user_name", "admin_name", "department",
    "rack_name", "rack_unit_start", "rack_unit_size", "description",
    ...customFields.map((f: any) => `cf:${f.id}`),
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([allHeaders, keyRow, [...fixedExample, ...customExample]]);

  // 컬럼 너비
  ws["!cols"] = allHeaders.map((h, i) => {
    const ex = fixedExample[i] || customExample[i - fixedHeaders.length] || "";
    return { wch: Math.max(h.length * 2, String(ex).length, 8) + 2 };
  });

  XLSX.utils.book_append_sheet(wb, ws, "자산양식");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=asset-template.xlsx",
    },
  });
}

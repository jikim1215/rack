import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export async function GET() {
  const headers = [
    "유형", "이름", "제조사", "모델", "시리얼", "IP주소", "자산태그",
    "상태", "OS", "접근IP", "사용자", "관리자", "부서", "랙이름",
    "시작U", "크기U", "구매일", "보증만료", "EoS일자", "설명",
  ];

  const example = [
    "server", "웹서버-01", "Dell", "PowerEdge R740", "SRV-001",
    "10.10.1.11", "SV-001", "active", "Rocky Linux 8.9", "10.10.1.11",
    "", "김정보", "정보운영과", "A-01", "1", "2",
    "2022-03-15", "2027-03-14", "2029-12-31", "메인 웹서버",
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);

  // 컬럼 너비 자동조정
  ws["!cols"] = headers.map((h, i) => {
    const exampleVal = example[i] || "";
    const maxLen = Math.max(h.length * 2, exampleVal.length, 8);
    return { wch: maxLen + 2 };
  });

  XLSX.utils.book_append_sheet(wb, ws, "자산템플릿");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new Response(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=asset-template.xlsx",
    },
  });
}

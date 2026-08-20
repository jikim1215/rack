import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, scopeWhere } from "@/lib/authz";
import * as XLSX from "xlsx";

/**
 * 제출용 "정보시스템 관리대장" export
 * KISA 분기 제출 양식 컬럼 구조로 시스템(SSOT) 데이터를 생성한다.
 */

const TYPE_KOR: Record<string, string> = {
  server: "서버", network: "네트워크", security: "정보보호시스템",
  telecom: "기타", vm: "서버", other: "기타",
};

// 사설 IP 대역 판별 (RFC1918)
function isPrivate(ip: string): boolean {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);
}

export async function GET() {
  const actor = await getActor();
  try {
    assertCanRead(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }
  const db = getDb();
  // 팀 계정은 자기 팀 자산의 대장 행만 노출
  const scope = scopeWhere(actor, "a.team_id");

  // 커스텀필드 id (관리번호=자산코드)
  const cf = db.prepare("SELECT id, field_key FROM custom_fields WHERE field_key IN ('asset_code')").all() as any[];
  const codeFid = cf.find((f) => f.field_key === "asset_code")?.id ?? -1;

  const assets = db.prepare(`
    SELECT a.*,
      (SELECT value FROM custom_values WHERE asset_id=a.id AND field_id=?) AS asset_code
    FROM assets a
    WHERE ${scope.sql}
    ORDER BY a.network_zone, a.asset_type, a.id
  `).all(codeFid, ...scope.params) as any[];

  const headers = [
    "본부명", "부서명", "사용여부", "관리자", "관리책임자",
    "종류(서버ㆍ네트워크 등)", "제조사", "모델명", "운영체제", "도입일자",
    "관리번호", "자산설명(용도)", "공인IP", "사설IP", "상세 위치",
    "망구분", "서비스명", "웹 도메인(URL)", "비고",
  ];

  const data = assets.map((a) => {
    const ip = String(a.ip_address || "").trim();
    const pubIp = ip && !isPrivate(ip) ? ip : "";
    const priIp = ip && isPrivate(ip) ? ip : "";
    return [
      "",                                   // 본부명
      a.department || "",                   // 부서명
      a.status === "active" ? "O" : "X",    // 사용여부
      a.admin_name || "",                   // 관리자
      "",                                   // 관리책임자
      TYPE_KOR[a.asset_type] || "기타",     // 종류
      a.manufacturer || "",                 // 제조사
      a.model || "",                        // 모델명
      a.os || "",                           // 운영체제
      a.purchase_date || "",                // 도입일자
      a.asset_code || a.asset_tag || "",    // 관리번호
      a.description || "",                  // 자산설명(용도)
      pubIp || "-",                         // 공인IP
      priIp || ip || "-",                   // 사설IP
      "",                                   // 상세 위치
      a.network_zone || "",                 // 망구분
      "",                                   // 서비스명
      "",                                   // 웹 도메인
      "",                                   // 비고
    ];
  });

  // 대외비 보호기간 = 생산일 + 1년
  const now = new Date();
  const until = `${now.getFullYear() + 1}. ${now.getMonth() + 1}. ${now.getDate()}. 까지`;
  const blank = headers.map(() => "");
  const titleRow = [...blank]; titleRow[10] = "대 외 비";
  const untilRow = [...blank]; untilRow[10] = until;

  const aoa = [titleRow, untilRow, [...blank], headers, ...data];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = headers.map((h, i) => ({ wch: Math.max(h.length, ...data.slice(0, 50).map((r) => String(r[i] ?? "").length), 6) + 2 }));
  XLSX.utils.book_append_sheet(wb, ws, "정보시스템 관리대장");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const fname = `정보시스템_관리대장_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}.xlsx`;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`,
    },
  });
}

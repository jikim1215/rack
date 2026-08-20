import { getDb } from "@/lib/db";
import * as XLSX from "xlsx";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanDownload } from "@/lib/authz";

/**
 * 자산 양식 다운로드 — 커스텀 필드 동적 반영
 * 기본 고정 컬럼 + 활성 커스텀 필드가 자동으로 헤더에 추가됨.
 * 예시 행은 asset_type 6종(server/network/security/telecom/vm/other)을 각각 1건씩 제공해
 * 작성자가 카테고리별 기입 형식을 그대로 참고할 수 있게 한다.
 */
export async function GET() {
  const actor = await getActor();
  try {
    assertCanDownload(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const db = getDb();

  // 활성 커스텀 필드 조회
  const customFields = db.prepare(
    "SELECT id, field_key, field_label, field_type, field_group FROM custom_fields WHERE is_active = 1 ORDER BY field_group, sort_order, id"
  ).all() as any[];

  // 고정 헤더 — 화면(자산관리) 매크로 컬럼 순서와 동일하게 선두 배치
  const fixedHeaders = [
    "유형", "망구분", "이름", "제조사", "모델", "IP주소", "관리부서", "위치", "상태",
    "시리얼번호", "자산태그", "OS", "접근IP", "사용자", "관리자",
    "기밀성", "무결성", "가용성",
    "시작U", "크기U", "설명",
  ];

  const customHeaders = customFields.map((f: any) => `${f.field_label}`);
  const allHeaders = [...fixedHeaders, ...customHeaders];

  // 필드 키 매핑 행 (2번째 행 — import 시 매핑용). fixedHeaders와 1:1 정렬.
  const keyRow = [
    "asset_type", "network_zone", "asset_name", "manufacturer", "model", "ip_address", "department", "rack_name", "status",
    "serial_number", "asset_tag", "os", "access_ip", "user_name", "admin_name",
    "cia_c", "cia_i", "cia_a",
    "rack_unit_start", "rack_unit_size", "description",
    ...customFields.map((f: any) => `cf:${f.id}`),
  ];

  // 카테고리별 예시 행 (유형 6종 전부) — 열 순서는 fixedHeaders와 1:1.
  const fixedExamples: string[][] = [
    ["server",   "업무망",   "웹서버-01",         "Dell",       "PowerEdge R740",   "10.10.1.11", "정보운영과",   "A-01", "active",  "SRV-001", "SV-001", "Rocky Linux 8.9", "10.10.1.11", "", "김정보", "3", "3", "2", "1",  "2", "메인 웹서버"],
    ["network",  "업무망",   "백본스위치-01",     "Cisco",      "Catalyst 9500",    "10.10.0.2",  "정보운영과",   "A-01", "active",  "NW-001",  "SW-001", "IOS-XE 17.9",     "10.10.0.2",  "", "이통신", "3", "3", "3", "20", "1", "코어 백본 스위치"],
    ["security", "인터넷망", "방화벽-01",         "Palo Alto",  "PA-3260",          "10.20.0.1",  "보안운영팀",   "B-02", "active",  "SEC-001", "FW-001", "PAN-OS 11.1",     "10.20.0.1",  "", "박보안", "3", "3", "3", "10", "2", "경계 방화벽(HA)"],
    ["telecom",  "업무망",   "VoIP게이트웨이-01", "삼성",       "OfficeServ 7400",  "10.30.0.5",  "정보운영과",   "B-02", "active",  "TEL-001", "VG-001", "",                "10.30.0.5",  "", "최전화", "2", "2", "2", "5",  "1", "내선 전화 게이트웨이"],
    ["vm",       "업무망",   "가상서버-01",       "VMware",     "vSphere VM",       "10.10.2.21", "정보운영과",   "",     "active",  "VM-001",  "",       "Ubuntu 22.04",    "10.10.2.21", "", "정가상", "2", "2", "2", "",   "1", "웹서비스용 가상머신(호스트 A-01)"],
    ["other",    "",         "기타장비-01",       "기타",       "범용모델",         "",           "자산관리팀",   "창고", "standby", "ETC-001", "",       "",                "",           "", "한기타", "1", "1", "1", "",   "1", "예비/기타 품목"],
  ];

  const customExample = customFields.map((f: any) => {
    if (f.field_type === "date") return "2024-01-01";
    if (f.field_type === "number") return "0";
    if (f.field_type === "multi-text") return "값1|값2";
    return "";
  });
  const exampleRows = fixedExamples.map((fx) => [...fx, ...customExample]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([allHeaders, keyRow, ...exampleRows]);

  // 컬럼 너비 — 헤더/예시(첫 행) 중 넓은 쪽 기준
  ws["!cols"] = allHeaders.map((h, i) => {
    const ex = String(fixedExamples[0][i] ?? customExample[i - fixedHeaders.length] ?? "");
    return { wch: Math.max(h.length * 2, ex.length, 8) + 2 };
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

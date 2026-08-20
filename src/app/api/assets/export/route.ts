import { getDb } from "@/lib/db";
import * as XLSX from "xlsx";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanDownload, scopeWhere } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

/**
 * 자산 내보내기 — 커스텀 필드 동적 반영
 * 템플릿과 동일한 컬럼 구조 + 커스텀 필드 값 포함
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

  // 행 수준 권한: admin/viewer 전체, team 자기 팀 자산만
  const scope = scopeWhere(actor, "a.team_id");

  // 활성 커스텀 필드
  const customFields = db.prepare(
    "SELECT id, field_key, field_label, field_type, field_group FROM custom_fields WHERE is_active = 1 ORDER BY field_group, sort_order, id"
  ).all() as any[];

  // 자산 조회 (권한 범위 적용)
  const assets = db.prepare(`
    SELECT a.*, r.rack_name, l.location_name
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id
    WHERE ${scope.sql}
    ORDER BY a.id
  `).all(...scope.params) as any[];

  // 커스텀 필드 값 전체 조회
  const allCvs = db.prepare(`
    SELECT cv.asset_id, cv.field_id, cv.value
    FROM custom_values cv
    JOIN custom_fields cf ON cv.field_id = cf.id
    WHERE cf.is_active = 1
  `).all() as any[];

  // asset_id → { field_id → value }
  const cvMap: Record<number, Record<number, string>> = {};
  for (const cv of allCvs) {
    if (!cvMap[cv.asset_id]) cvMap[cv.asset_id] = {};
    cvMap[cv.asset_id][cv.field_id] = cv.value;
  }

  // 헤더 (템플릿과 동일 구조)
  const fixedHeaders = [
    "유형", "이름", "제조사", "모델", "시리얼번호", "IP주소", "자산태그",
    "상태", "망구분", "OS", "접근IP", "사용자", "관리자", "부서",
    "구매일", "보증만료", "EoS",
    "기밀성", "무결성", "가용성",
    "랙이름", "시작U", "크기U", "설명", "등급",
  ];
  const customHeaders = customFields.map((f: any) => f.field_label);
  const allHeaders = [...fixedHeaders, ...customHeaders];

  // 키 행 (import 호환)
  const keyRow = [
    "asset_type", "asset_name", "manufacturer", "model", "serial_number",
    "ip_address", "asset_tag", "status", "network_zone", "os", "access_ip",
    "user_name", "admin_name", "department",
    "purchase_date", "warranty_date", "eos_date",
    "cia_c", "cia_i", "cia_a",
    "rack_name", "rack_unit_start", "rack_unit_size", "description", "",
    ...customFields.map((f: any) => `cf:${f.id}`),
  ];

  // 데이터 행
  const data = assets.map((a: any) => {
    const fixedData = [
      a.asset_type, a.asset_name, a.manufacturer, a.model, a.serial_number,
      a.ip_address, a.asset_tag, a.status, a.network_zone, a.os, a.access_ip,
      a.user_name, a.admin_name, a.department,
      a.purchase_date ?? "", a.warranty_date ?? "", a.eos_date ?? "",
      a.cia_c ?? "", a.cia_i ?? "", a.cia_a ?? "",
      a.rack_name || "", a.rack_unit_start ?? "", a.rack_unit_size ?? "",
      a.description, a.cia_grade || "",
    ];
    const customData = customFields.map((f: any) => {
      const val = cvMap[a.id]?.[f.id] || "";
      // multi-text는 | 구분자로 변환
      if (f.field_type === "multi-text" && val) {
        try {
          const arr = JSON.parse(val);
          return Array.isArray(arr) ? arr.join("|") : val;
        } catch { return val; }
      }
      return val;
    });
    return [...fixedData, ...customData];
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([allHeaders, keyRow, ...data]);

  // 컬럼 너비
  ws["!cols"] = allHeaders.map((h, i) => {
    const maxLen = Math.max(
      h.length * 2,
      ...data.slice(0, 20).map((row) => String(row[i] ?? "").length),
      8
    );
    return { wch: Math.min(maxLen + 2, 40) };
  });

  XLSX.utils.book_append_sheet(wb, ws, "자산목록");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  // 필수 감사 기록: 내보내기 이벤트 (actor + scope + rowcount + 컬럼셋/시트)
  const exportScope = actor?.role === "team" ? `team:${actor.teamId}` : "all";
  logAudit(db, {
    entityType: "asset",
    entityId: null,
    entityName: "자산목록 내보내기",
    action: "create",
    changedBy: actor?.username || "system",
    newData: {
      event: "asset_export",
      actor: actor?.username || "system",
      role: actor?.role || "unknown",
      scope: exportScope,
      sheet: "자산목록",
      columns: allHeaders,
      rowCount: assets.length,
    },
  });

  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=assets-export.xlsx",
    },
  });
}

export const dynamic = "force-dynamic";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "@/lib/db";
import { scopeWhere, actorFromSession } from "@/lib/authz";
import { getSession } from "@/lib/auth";
import InspectionView from "./InspectionView";

// 시리얼 불일치 실사 목록 (외부 검토 R3-3 합의): AX 대장 대사 산출물을 화면에서 참조 가능하게.
// 파일이 없으면(배포본 등) 조용히 숨긴다 — 스크립트 산출물이라 존재가 보장되지 않는다.
// 전역 대사 목록(팀 무관)이라 독립 부서(team) 계정에는 노출하지 않는다 — 총괄/전체열람만 참조.
function loadSerialMismatches(): { asset_tag: string; ledger_name: string; ledger_serial: string; db_asset: string; db_serial: string }[] {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "scripts", ".serial-verify-list.json"), "utf8"));
  } catch {
    return [];
  }
}

export default async function InspectionPage() {
  const db = getDb();
  const actor = actorFromSession(await getSession());
  const scope = scopeWhere(actor, "a.team_id");
  const subScope = scopeWhere(actor, "s.team_id");

  // 회차 목록 + 진행률 (요청자 스코프 기준 — GET /api/inventory-audits 와 동일 규약)
  // 대상 = 장비 전체 + 부속자산(폐기 제외).
  const audits = db.prepare(`
    SELECT ia.*,
      (SELECT COUNT(*) FROM assets a WHERE ${scope.sql})
      + (SELECT COUNT(*) FROM sub_assets s WHERE s.status != 'disposed' AND ${subScope.sql}) AS total_assets,
      (SELECT COUNT(*) FROM inventory_audit_checks c
        JOIN assets a ON c.asset_id = a.id
        WHERE c.audit_id = ia.id AND ${scope.sql})
      + (SELECT COUNT(*) FROM inventory_audit_checks c
        JOIN sub_assets s ON c.sub_asset_id = s.id
        WHERE c.audit_id = ia.id AND s.status != 'disposed' AND ${subScope.sql}) AS checked_assets
    FROM inventory_audits ia
    ORDER BY ia.id DESC
  `).all(...scope.params, ...subScope.params, ...scope.params, ...subScope.params) as any[];

  // 최신 회차를 초기 선택 — 대상별 확인 현황(장비 + 부속 UNION)을 SSR 로 전달, 이후 갱신은 fetch
  // (GET /api/inventory-audits/[id]/checks 와 동일 모양)
  const selected = audits[0] ?? null;
  const rows = selected
    ? db.prepare(`
        SELECT 'asset' AS kind, a.id AS target_id, a.asset_type,
               a.asset_name AS name,
               CASE a.asset_type
                 WHEN 'server' THEN '서버' WHEN 'network' THEN '네트워크'
                 WHEN 'security' THEN '정보보호' WHEN 'telecom' THEN '전화설비'
                 WHEN 'vm' THEN '가상머신' ELSE '기타' END AS type_or_category,
               r.rack_name AS location, a.serial_number, a.asset_tag AS code,
               c.id AS check_id, c.result, c.note, c.checked_by, c.checked_at
        FROM assets a
        LEFT JOIN racks r ON a.rack_id = r.id
        LEFT JOIN inventory_audit_checks c ON c.asset_id = a.id AND c.audit_id = ?
        WHERE ${scope.sql}
        UNION ALL
        SELECT 'sub' AS kind, s.id AS target_id, NULL AS asset_type,
               s.sub_name AS name,
               TRIM(COALESCE(s.category_mid, '') ||
                 CASE WHEN COALESCE(s.category_minor, '') != '' THEN ' > ' || s.category_minor ELSE '' END) AS type_or_category,
               s.place AS location, s.serial_number, s.asset_code AS code,
               c.id AS check_id, c.result, c.note, c.checked_by, c.checked_at
        FROM sub_assets s
        LEFT JOIN inventory_audit_checks c ON c.sub_asset_id = s.id AND c.audit_id = ?
        WHERE s.status != 'disposed' AND ${subScope.sql}
        ORDER BY name
      `).all(selected.id, ...scope.params, selected.id, ...subScope.params) as any[]
    : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="eyebrow">ASSET INSPECTION</p>
          <h2 className="text-2xl font-bold tracking-tight">자산실사</h2>
        </div>
      </div>
      <InspectionView
        initialAudits={audits}
        initialAuditId={selected?.id ?? null}
        initialRows={rows}
        role={actor?.role ?? ""}
        serialMismatches={actor?.role === "team" ? [] : loadSerialMismatches()}
      />
    </div>
  );
}

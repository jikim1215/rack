import { getDb } from "@/lib/db";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanDownload, scopeWhere } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { buildSubAssetWorkbook } from "@/lib/subasset-import";

// 부속자산 일괄 다운로드 — 자산관리와 동일 정책(팀 스코프). 현재 조회 범위의 행을 엑셀로 내보낸다.
// 헤더는 임포트 라벨과 1:1 → 내려받아 값만 채워 다시 업로드하는 왕복 양식으로도 쓰인다.
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
  const scope = scopeWhere(actor, "s.team_id");
  const rows = db.prepare(`
    SELECT s.*, a.asset_name AS parent_name, t.team_name AS team_name
    FROM sub_assets s
    LEFT JOIN assets a ON s.parent_asset_id = a.id
    LEFT JOIN teams t ON s.team_id = t.id
    WHERE ${scope.sql}
    ORDER BY s.asset_code, s.id
  `).all(...scope.params) as Record<string, unknown>[];

  const buf = buildSubAssetWorkbook(rows);

  logAudit(db, {
    entityType: "sub_asset",
    entityId: null,
    entityName: "부속자산 내보내기",
    action: "create",
    changedBy: actor?.username || "system",
    newData: { event: "subasset_export", rowCount: rows.length, sheet: "부속자산" },
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=subassets-export.xlsx",
    },
  });
}

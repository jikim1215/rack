import { getDb } from "@/lib/db";
import { getActor, withApi } from "@/lib/api-authz";
import { assertMenuAccess, assertCanDownload, scopeWhere } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { buildTargetWorkbook } from "@/lib/maintenance-target-import";
import type { MaintenanceTargetRow } from "@/lib/db-types";

export const GET = withApi(async () => {
  const actor = await getActor();
  assertMenuAccess(actor, "maintenance");
  assertCanDownload(actor);

  const db = getDb();
  const scope = scopeWhere(actor, "a.team_id");
  const rows = db.prepare(`
    SELECT mt.*, COALESCE(a.asset_name, mt.asset_name) AS asset_name
    FROM maintenance_targets mt
    LEFT JOIN assets a ON mt.asset_id = a.id
    WHERE (mt.asset_id IS NULL OR ${scope.sql})
    ORDER BY mt.id
  `).all(...scope.params) as MaintenanceTargetRow[];

  const buf = buildTargetWorkbook(rows as unknown as Record<string, unknown>[]);

  logAudit(db, {
    entityType: "maintenance",
    entityId: null,
    entityName: "유지관리 대상 내보내기",
    action: "create",
    changedBy: actor.username,
    newData: { event: "target_export", rowCount: rows.length, sheet: "유지관리대상" },
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=maintenance-targets-export.xlsx",
    },
  });
});

import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertAdmin, scopeWhere } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { asBody, str } from "@/lib/validation/input";
import type { InventoryAuditRow } from "@/lib/db-types";

// 자산실사 회차 목록 + 진행률. 진행률은 요청자의 팀 스코프 기준으로 계산한다
// (team 계정은 자기 팀 자산 대비 확인 수만 본다).
export const GET = withApi(async () => {
  const actor = await getActor();
  assertMenuAccess(actor, "inspection");
  const db = getDb();
  const scope = scopeWhere(actor, "a.team_id");
  const subScope = scopeWhere(actor, "s.team_id");
  // 대상 = 팀 스코프 장비 전체 + 부속자산(폐기 제외). total/checked 컬럼명은 호환 유지.
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
  `).all(...scope.params, ...subScope.params, ...scope.params, ...subScope.params) as (InventoryAuditRow & { total_assets: number; checked_assets: number })[];
  return NextResponse.json(audits);
});

// 회차 생성 — 총괄(admin) 전용.
export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertAdmin(actor);
  const b = asBody(await readJson(req));
  const auditName = str(b, "audit_name", { required: true, max: 200, label: "회차 이름" });
  const description = str(b, "description", { max: 2000, label: "설명" });

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO inventory_audits (audit_name, status, created_by, description)
    VALUES (?, 'open', ?, ?)
  `).run(auditName, actor.username, description);

  logAudit(db, {
    entityType: "inventory_audit",
    entityId: Number(result.lastInsertRowid),
    entityName: `자산실사: ${auditName}`,
    action: "create",
    changedBy: actor.username,
    newData: { audit_name: auditName, description },
  });

  const audit = db.prepare("SELECT * FROM inventory_audits WHERE id = ?").get(result.lastInsertRowid) as InventoryAuditRow;
  return NextResponse.json(audit, { status: 201 });
});

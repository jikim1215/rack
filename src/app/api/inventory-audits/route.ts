import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, assertAdmin, scopeWhere } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

// 자산실사 회차 목록 + 진행률. 진행률은 요청자의 팀 스코프 기준으로 계산한다
// (team 계정은 자기 팀 자산 대비 확인 수만 본다).
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
  `).all(...scope.params, ...subScope.params, ...scope.params, ...subScope.params);
  return NextResponse.json(audits);
}

// 회차 생성 — 총괄(admin) 전용.
export async function POST(req: NextRequest) {
  const actor = await getActor();
  try {
    assertAdmin(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }
  const body = await req.json();
  const auditName = String(body.audit_name || "").trim();
  if (!auditName) {
    return NextResponse.json({ error: "회차 이름을 입력하세요." }, { status: 400 });
  }
  const description = String(body.description || "");

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

  const audit = db.prepare("SELECT * FROM inventory_audits WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(audit, { status: 201 });
}

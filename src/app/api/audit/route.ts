import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertAdmin } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const actor = await getActor();
  try {
    assertAdmin(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const db = getDb();
  const entityType = req.nextUrl.searchParams.get("entity_type");
  const entityId = req.nextUrl.searchParams.get("entity_id");
  // 1년 보존 규모(수만 행) 대비: 서버측 페이지네이션 — 한 화면 최대 200, 기본 50
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 200);
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset")) || 0, 0);

  const VALID_ENTITY_TYPES = ["asset", "rack", "location", "frame", "contract", "movement", "maintenance", "inventory_audit", "sub_asset"];

  const conditions: string[] = [];
  const params: any[] = [];

  if (entityType) {
    if (!VALID_ENTITY_TYPES.includes(entityType)) {
      return NextResponse.json({ error: "Invalid entity_type" }, { status: 400 });
    }
    conditions.push("entity_type = ?");
    params.push(entityType);
  }
  if (entityId) {
    conditions.push("entity_id = ?");
    params.push(Number(entityId));
  }

  const where = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
  // 필터 조합은 idx_audit_logs(entity_type, entity_id), 시간 정렬은 idx_audit_logs_created 사용
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM audit_logs${where}`).get(...params) as { c: number }).c;
  const logs = db.prepare(
    `SELECT * FROM audit_logs${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as any[];

  const parsed = logs.map((log) => ({
    ...log,
    changed_fields: safeJsonParse(log.changed_fields, []),
    old_values: safeJsonParse(log.old_values, {}),
    new_values: safeJsonParse(log.new_values, {}),
  }));

  return NextResponse.json({ rows: parsed, total });
}

function safeJsonParse(str: string, fallback: any): any {
  try { return JSON.parse(str); } catch { return fallback; }
}

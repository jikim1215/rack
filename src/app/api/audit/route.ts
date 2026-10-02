import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { AUDIT_ENTITY_TYPES } from "@/lib/db-types";
import { getActor, withApi } from "@/lib/api-authz";
import { pageParams } from "@/lib/validation/input";
import { assertAdmin } from "@/lib/authz";
import type { AuditLogRow, CountRow } from "@/lib/db-types";

export const GET = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertAdmin(actor);

  const db = getDb();
  const entityType = req.nextUrl.searchParams.get("entity_type");
  const entityId = req.nextUrl.searchParams.get("entity_id");
  // 1년 보존 규모(수만 행) 대비: 서버측 페이지네이션 — 한 화면 최대 200, 기본 50
  const { limit, offset } = pageParams(req.nextUrl.searchParams, { defaultLimit: 50, maxLimit: 200 });

  const VALID_ENTITY_TYPES: readonly string[] = AUDIT_ENTITY_TYPES;

  const conditions: string[] = [];
  const params: unknown[] = [];

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
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM audit_logs${where}`).get(...params) as CountRow).c;
  const logs = db.prepare(
    `SELECT * FROM audit_logs${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as AuditLogRow[];

  const parsed = logs.map((log) => ({
    ...log,
    changed_fields: safeJsonParse(log.changed_fields, []),
    old_values: safeJsonParse(log.old_values, {}),
    new_values: safeJsonParse(log.new_values, {}),
  }));

  return NextResponse.json({ rows: parsed, total });
});

function safeJsonParse(str: string, fallback: unknown): unknown {
  try { return JSON.parse(str); } catch { return fallback; }
}

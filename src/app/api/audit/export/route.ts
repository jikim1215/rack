import { NextRequest, NextResponse } from "next/server";
import { AUDIT_ENTITY_TYPES } from "@/lib/db-types";
import { getDb } from "@/lib/db";
import { getActor, withApi } from "@/lib/api-authz";
import { assertAdmin } from "@/lib/authz";
import { logAccess, clientMeta } from "@/lib/access-log";
import { kstStamp, toCsv } from "@/lib/csv";
import type { AuditLogRow } from "@/lib/db-types";

export const GET = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertAdmin(actor);

  const db = getDb();
  const { ip, userAgent } = clientMeta(req);
  logAccess(db, {
    userId: actor.userId,
    username: actor.username,
    ip,
    userAgent,
    action: "login",
    resultCode: "200",
    failureReason: "audit_export",
  });

  const entityType = req.nextUrl.searchParams.get("entity_type");
  const entityId = req.nextUrl.searchParams.get("entity_id");

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
  const logs = db
    .prepare(`SELECT * FROM audit_logs${where} ORDER BY created_at DESC, id DESC LIMIT 100000`)
    .all(...params) as AuditLogRow[];

  const headers = [
    "ID",
    "엔터티타입",
    "엔터티ID",
    "엔터티명",
    "동작",
    "수행자",
    "변경필드",
    "이전값",
    "신규값",
    "생성시각",
  ];

  const csvContent = toCsv([
    headers,
    ...logs.map((log) => [
      log.id,
      log.entity_type,
      log.entity_id ?? "",
      log.entity_name,
      log.action,
      log.changed_by,
      log.changed_fields,
      log.old_values,
      log.new_values,
      log.created_at,
    ]),
  ]);

  const filename = `audit-${kstStamp()}.csv`;

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
});

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActor, withApi } from "@/lib/api-authz";
import { assertAdmin } from "@/lib/authz";
import { logAccess, clientMeta } from "@/lib/access-log";
import type { AuditLogRow } from "@/lib/db-types";

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = String(val);
  if (/^[=+\-@]/.test(str)) {
    str = "'" + str;
  }
  if (/[",\r\n]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function getFormattedTimestamp(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const YYYY = kst.getUTCFullYear();
  const MM = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const DD = String(kst.getUTCDate()).padStart(2, "0");
  const HH = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${YYYY}${MM}${DD}-${HH}${mm}`;
}

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

  const VALID_ENTITY_TYPES = [
    "asset",
    "rack",
    "location",
    "frame",
    "contract",
    "movement",
    "maintenance",
    "inventory_audit",
    "sub_asset",
    "user",
    "team",
    "permission",
    "feedback",
  ];

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

  const csvRows = logs.map((log) =>
    [
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
    ]
      .map(escapeCsvCell)
      .join(",")
  );

  const csvContent = "\uFEFF" + [headers.map(escapeCsvCell).join(","), ...csvRows].join("\r\n");

  const filename = `audit-${getFormattedTimestamp()}.csv`;

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
});

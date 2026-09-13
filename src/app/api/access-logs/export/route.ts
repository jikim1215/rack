import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActor, withApi } from "@/lib/api-authz";
import { assertAdmin } from "@/lib/authz";
import { logAccess, clientMeta } from "@/lib/access-log";
import type { AccessLogRow } from "@/lib/db-types";

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
    failureReason: "access_logs_export",
  });

  const action = req.nextUrl.searchParams.get("action") || "";
  const username = (req.nextUrl.searchParams.get("username") || "").trim();

  const where: string[] = [];
  const params: unknown[] = [];

  if (["login", "logout", "fail"].includes(action)) {
    where.push("action = ?");
    params.push(action);
  }
  if (username) {
    where.push("username LIKE ?");
    params.push(`%${username}%`);
  }

  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const sql = `SELECT id, user_id, username, ip, user_agent, action, result_code, failure_reason, created_at
    FROM access_logs ${whereSql}
    ORDER BY id DESC LIMIT 100000`;

  const rows = db.prepare(sql).all(...params) as AccessLogRow[];

  const headers = [
    "ID",
    "사용자ID",
    "사용자명",
    "IP",
    "User-Agent",
    "동작",
    "결과코드",
    "실패사유",
    "생성시각",
  ];

  const csvRows = rows.map((row) =>
    [
      row.id,
      row.user_id ?? "",
      row.username,
      row.ip,
      row.user_agent,
      row.action,
      row.result_code ?? "",
      row.failure_reason,
      row.created_at,
    ]
      .map(escapeCsvCell)
      .join(",")
  );

  const csvContent = "\uFEFF" + [headers.map(escapeCsvCell).join(","), ...csvRows].join("\r\n");

  const filename = `access-logs-${getFormattedTimestamp()}.csv`;

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
});

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActor, withApi } from "@/lib/api-authz";
import { assertAdmin } from "@/lib/authz";
import { logAccess, clientMeta } from "@/lib/access-log";
import { kstStamp, toCsv } from "@/lib/csv";
import type { AccessLogRow } from "@/lib/db-types";

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

  const csvContent = toCsv([
    headers,
    ...rows.map((row) => [
      row.id,
      row.user_id ?? "",
      row.username,
      row.ip,
      row.user_agent,
      row.action,
      row.result_code ?? "",
      row.failure_reason,
      row.created_at,
    ]),
  ]);

  const filename = `access-logs-${kstStamp()}.csv`;

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
});

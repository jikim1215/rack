import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertAdmin } from "@/lib/authz";

// 접속기록 조회 (AC-19) — 총괄(admin) 전용. 최근순, 옵션 필터(action/username).
export async function GET(req: NextRequest) {
  const actor = await getActor();
  try { assertAdmin(actor); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const db = getDb();
  const action = req.nextUrl.searchParams.get("action") || "";
  const username = (req.nextUrl.searchParams.get("username") || "").trim();
  // 1년 보존 규모(십만 행대) 대비: 서버측 페이지네이션 — 한 화면 최대 200, 기본 50
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") || 50), 1), 200);
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset")) || 0, 0);
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
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM access_logs ${whereSql}`).get(...params) as { c: number }).c;
  const sql = `SELECT id, user_id, username, ip, user_agent, action, result_code, failure_reason, created_at
    FROM access_logs ${whereSql}
    ORDER BY id DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...params, limit, offset);
  return NextResponse.json({ rows, total });
}

import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite } from "@/lib/authz";
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, validateFeedbackInput } from "@/lib/feedback";
import { ValidationError } from "@/lib/validation/input";
import type { FeedbackRow, UserRow } from "@/lib/db-types";

// ── 개선의견/불편사항 목록·접수 ──
// 메뉴 권한 'feedback'(기본: 전 역할 접근+쓰기). 팀 스코프 없음 — 자산 데이터가 아니다. 처리는 /api/feedback/[id] (총괄).
export const GET = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuAccess(actor, "feedback");
  const db = getDb();
  const sp = req.nextUrl.searchParams;

  // 상태별 집계 (필터 칩 + 사이드바 미처리 배지용). ?summary=1 이면 집계만 반환.
  const byStatus: Record<string, number> = {};
  for (const r of db.prepare("SELECT status, COUNT(*) AS c FROM feedback GROUP BY status").all() as { status: string; c: number }[]) {
    byStatus[r.status] = r.c;
  }
  if (sp.get("summary") === "1") return NextResponse.json({ byStatus });

  const status = sp.get("status") || "";
  const category = sp.get("category") || "";
  const mine = sp.get("mine") === "1";
  const q = (sp.get("q") || "").trim();
  const sort = sp.get("sort") === "votes" ? "votes" : "recent";
  const limit = Math.min(Math.max(Number(sp.get("limit") || 30), 1), 100);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);

  const where: string[] = [];
  const params: unknown[] = [];
  if ((FEEDBACK_STATUSES as readonly string[]).includes(status)) { where.push("f.status = ?"); params.push(status); }
  else if (status === "active") { where.push("f.status IN ('open','in_review','planned')"); }
  if ((FEEDBACK_CATEGORIES as readonly string[]).includes(category)) { where.push("f.category = ?"); params.push(category); }
  if (mine) { where.push("f.user_id = ?"); params.push(actor.userId); }
  if (q) { where.push("(f.title LIKE ? OR f.content LIKE ? OR f.page_path LIKE ?)"); const like = `%${q}%`; params.push(like, like, like); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const orderSql = sort === "votes" ? "ORDER BY votes DESC, f.id DESC" : "ORDER BY f.id DESC";

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM feedback f ${whereSql}`).get(...params) as { c: number }).c;
  const rows = db.prepare(`
    SELECT f.*, t.team_name,
      (SELECT COUNT(*) FROM feedback_votes v WHERE v.feedback_id = f.id) AS votes,
      EXISTS (SELECT 1 FROM feedback_votes v WHERE v.feedback_id = f.id AND v.user_id = ?) AS voted
    FROM feedback f LEFT JOIN teams t ON f.team_id = t.id
    ${whereSql} ${orderSql} LIMIT ? OFFSET ?
  `).all(actor.userId, ...params, limit, offset) as (FeedbackRow & { team_name: string | null; votes: number; voted: number })[];

  return NextResponse.json({ rows, total, byStatus });
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "feedback");
  const v = validateFeedbackInput(await readJson(req));
  if (!v.ok) throw new ValidationError(v.error);

  const db = getDb();
  const me = db.prepare("SELECT display_name FROM users WHERE id = ?").get(actor.userId) as Pick<UserRow, "display_name"> | undefined;
  const result = db.prepare(`
    INSERT INTO feedback (category, title, content, page_path, user_id, created_by, created_by_name, team_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    v.value.category, v.value.title, v.value.content, v.value.page_path,
    actor.userId, actor.username, me?.display_name || "", actor.teamId,
  );
  const row = db.prepare("SELECT * FROM feedback WHERE id = ?").get(result.lastInsertRowid) as FeedbackRow;
  return NextResponse.json(row, { status: 201 });
});

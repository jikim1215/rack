import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertAdmin } from "@/lib/authz";

// ── 정리큐(import_issue) 목록/처리 — 총괄(admin) 전용 ──
// 외부 검토 R7-1/R7-2 합의: 상태(미조치/조치완료/무시)로 큐를 비울 수 있게 하고,
// 배치(batch_id)·업로드시각·업로더를 노출해 임포트 결과와 같은 문맥으로 추적한다.
export async function GET(req: NextRequest) {
  const actor = await getActor();
  try { assertAdmin(actor); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const db = getDb();

  const status = req.nextUrl.searchParams.get("status") || "open";
  const issueType = req.nextUrl.searchParams.get("issue_type") || "";
  const batch = req.nextUrl.searchParams.get("batch") || "";
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") || 50), 1), 200);
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset")) || 0, 0);

  const where: string[] = [];
  const params: unknown[] = [];
  if (["open", "resolved", "ignored"].includes(status)) { where.push("ii.status = ?"); params.push(status); }
  if (["ip_format", "missing_id", "missing_os", "dup_suspect"].includes(issueType)) { where.push("ii.issue_type = ?"); params.push(issueType); }
  if (batch) { where.push("ii.batch_id = ?"); params.push(batch); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM import_issue ii ${whereSql}`).get(...params) as { c: number }).c;
  const rows = db.prepare(`
    SELECT ii.*, a.asset_name
    FROM import_issue ii LEFT JOIN assets a ON ii.asset_id = a.id
    ${whereSql}
    ORDER BY ii.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // 배치 요약 (필터바용): 배치별 건수·최초 시각·업로더
  const batches = db.prepare(`
    SELECT batch_id, COUNT(*) AS c, MIN(created_at) AS uploaded_at, MAX(created_by) AS uploaded_by
    FROM import_issue GROUP BY batch_id ORDER BY uploaded_at DESC LIMIT 30
  `).all();

  return NextResponse.json({ rows, total, batches });
}

export async function PATCH(req: NextRequest) {
  const actor = await getActor();
  try { assertAdmin(actor); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const db = getDb();

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const status = String(body.status || "");
  if (!id || !["open", "resolved", "ignored"].includes(status)) {
    return NextResponse.json({ error: "id와 status(open|resolved|ignored)가 필요합니다." }, { status: 400 });
  }
  const row = db.prepare("SELECT id FROM import_issue WHERE id = ?").get(id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  db.prepare(`
    UPDATE import_issue
    SET status = ?, resolved_by = ?,
        resolved_at = CASE WHEN ? = 'open' THEN '' ELSE datetime('now','localtime') END
    WHERE id = ?
  `).run(
    status,
    status === "open" ? "" : actor.username,
    status,
    id
  );
  return NextResponse.json({ ok: true });
}

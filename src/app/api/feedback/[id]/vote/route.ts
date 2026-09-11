import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi } from "@/lib/api-authz";
import { assertMenuWrite, AuthzError } from "@/lib/authz";
import { canVoteFeedback } from "@/lib/feedback";
import { pathId } from "@/lib/validation/input";
import type { FeedbackRow } from "@/lib/db-types";

// ── 공감 토글 ("나도 겪었어요") — 사용자당 1표, 본인 글 제외. 재호출 시 취소.
export const POST = withApi(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await getActor();
  assertMenuWrite(actor, "feedback");
  const id = pathId((await params).id);
  const db = getDb();
  const row = db.prepare("SELECT id, user_id, status FROM feedback WHERE id = ?").get(id) as Pick<FeedbackRow, "id" | "user_id" | "status"> | undefined;
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canVoteFeedback(actor, row)) throw new AuthzError("본인이 작성한 의견에는 공감할 수 없습니다.");

  const result = db.transaction(() => {
    const existing = db.prepare("SELECT 1 FROM feedback_votes WHERE feedback_id = ? AND user_id = ?").get(row.id, actor.userId);
    if (existing) {
      db.prepare("DELETE FROM feedback_votes WHERE feedback_id = ? AND user_id = ?").run(row.id, actor.userId);
    } else {
      db.prepare("INSERT INTO feedback_votes (feedback_id, user_id) VALUES (?, ?)").run(row.id, actor.userId);
    }
    const votes = (db.prepare("SELECT COUNT(*) AS c FROM feedback_votes WHERE feedback_id = ?").get(row.id) as { c: number }).c;
    return { voted: !existing, votes };
  })();
  return NextResponse.json(result);
});

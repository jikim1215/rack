import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuWrite, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import {
  canDeleteFeedback, canEditFeedback, canModerateFeedback,
  validateFeedbackInput, validateModeration,
} from "@/lib/feedback";
import { asBody, pathId, ValidationError } from "@/lib/validation/input";
import type { FeedbackRow } from "@/lib/db-types";

type Ctx = { params: Promise<{ id: string }> };
type OwnerRow = Pick<FeedbackRow, "id" | "user_id" | "status" | "priority" | "admin_reply" | "title">;

function loadRow(id: number): OwnerRow | undefined {
  return getDb().prepare("SELECT id, user_id, status, priority, admin_reply, title FROM feedback WHERE id = ?").get(id) as OwnerRow | undefined;
}

const SELECT_FULL = `
  SELECT f.*, t.team_name,
    (SELECT COUNT(*) FROM feedback_votes v WHERE v.feedback_id = f.id) AS votes,
    EXISTS (SELECT 1 FROM feedback_votes v WHERE v.feedback_id = f.id AND v.user_id = ?) AS voted
  FROM feedback f LEFT JOIN teams t ON f.team_id = t.id WHERE f.id = ?
`;

// ── 개선의견 단건 수정/처리/삭제 ──
//  - 작성자: '접수' 상태일 때만 유형/제목/내용 수정·삭제 (검토가 시작되면 잠금)
//  - 총괄  : 상태/우선순위/답변 변경 + 언제든 수정·삭제 (처리 내역은 감사로그 entity 'feedback')
export const PATCH = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "feedback");
  const id = pathId((await params).id);
  const row = loadRow(id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = asBody(await readJson(req));
  const db = getDb();
  const isModeration = body.status !== undefined || body.priority !== undefined || body.admin_reply !== undefined;

  if (isModeration) {
    if (!canModerateFeedback(actor)) throw new AuthzError("총괄(관리자)만 처리 상태·답변을 변경할 수 있습니다.");
    const v = validateModeration(body);
    if (!v.ok) throw new ValidationError(v.error);
    const sets: string[] = ["updated_at = datetime('now','localtime')"];
    const vals: unknown[] = [];
    if (v.value.status !== undefined) { sets.push("status = ?"); vals.push(v.value.status); }
    if (v.value.priority !== undefined) { sets.push("priority = ?"); vals.push(v.value.priority); }
    if (v.value.admin_reply !== undefined) {
      sets.push("admin_reply = ?"); vals.push(v.value.admin_reply);
      // 답변자·시각은 답변 내용이 실제로 바뀔 때만 갱신 (상태만 바꾸는 저장에 답변 시각이 튀지 않게)
      if (v.value.admin_reply !== row.admin_reply) {
        sets.push("replied_by = ?", "replied_at = datetime('now','localtime')");
        vals.push(actor.username);
      }
    }
    db.prepare(`UPDATE feedback SET ${sets.join(", ")} WHERE id = ?`).run(...vals, row.id);
    logAudit(db, {
      entityType: "feedback", entityId: row.id, entityName: row.title, action: "update", changedBy: actor.username,
      oldData: { status: row.status, priority: row.priority, admin_reply: row.admin_reply },
      newData: {
        status: v.value.status ?? row.status, priority: v.value.priority ?? row.priority,
        admin_reply: v.value.admin_reply ?? row.admin_reply,
      },
    });
  } else {
    if (!canEditFeedback(actor, row)) throw new AuthzError("접수 상태의 본인 의견만 수정할 수 있습니다.");
    const v = validateFeedbackInput(body);
    if (!v.ok) throw new ValidationError(v.error);
    db.prepare(`
      UPDATE feedback SET category = ?, title = ?, content = ?, page_path = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(v.value.category, v.value.title, v.value.content, v.value.page_path, row.id);
  }

  return NextResponse.json(db.prepare(SELECT_FULL).get(actor.userId, row.id));
});

export const DELETE = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "feedback");
  const id = pathId((await params).id);
  const row = loadRow(id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canDeleteFeedback(actor, row)) throw new AuthzError("접수 상태의 본인 의견만 삭제할 수 있습니다.");
  const db = getDb();
  db.prepare("DELETE FROM feedback WHERE id = ?").run(row.id);
  if (actor.role === "admin" && row.user_id !== actor.userId) {
    // 총괄이 타인 의견을 지운 경우만 감사 대상 (본인 글 삭제는 일반 사용자 행위)
    logAudit(db, { entityType: "feedback", entityId: row.id, entityName: row.title, action: "delete", changedBy: actor.username, oldData: { status: row.status } });
  }
  return NextResponse.json({ ok: true });
});

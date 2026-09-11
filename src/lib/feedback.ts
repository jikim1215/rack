// ── 개선의견/불편사항 수집 (순수 모듈) ──
// 직원이 시스템을 쓰다 겪은 불편·버그·개선 아이디어를 접수하고 총괄이 처리 상태를 관리한다.
// 자산 데이터가 아니므로 팀 row-level 스코프를 타지 않는다: 인증된 모든 역할(viewer 포함)이 작성 가능,
// 전원 열람 가능(중복 접수 방지 + 공감 투표로 우선순위 취합), 상태·답변·우선순위 변경은 총괄 전용.
// Next/DB 의존이 없어 단위테스트 대상. 라우트는 src/app/api/feedback/*.
import type { Actor } from "@/lib/authz";

export const FEEDBACK_CATEGORIES = ["bug", "inconvenience", "improvement", "question", "other"] as const;
export const FEEDBACK_STATUSES = ["open", "in_review", "planned", "done", "rejected"] as const;
export const FEEDBACK_PRIORITIES = ["low", "normal", "high"] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "오류/버그",
  inconvenience: "불편사항",
  improvement: "개선제안",
  question: "문의",
  other: "기타",
};
export const STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: "접수",
  in_review: "검토중",
  planned: "반영예정",
  done: "반영완료",
  rejected: "보류",
};
export const PRIORITY_LABELS: Record<FeedbackPriority, string> = {
  low: "낮음",
  normal: "보통",
  high: "높음",
};

export const TITLE_MAX = 120;
export const CONTENT_MAX = 4000;
export const REPLY_MAX = 4000;
export const PAGE_PATH_MAX = 200;

export interface FeedbackInput {
  category: FeedbackCategory;
  title: string;
  content: string;
  page_path: string;
}

/** 작성/수정 입력 검증. 성공 시 정규화된 값, 실패 시 사용자에게 보여줄 오류 문자열. */
export function validateFeedbackInput(body: unknown): { ok: true; value: FeedbackInput } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const category = String(b.category ?? "inconvenience");
  if (!(FEEDBACK_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: "유형이 올바르지 않습니다." };
  }
  const title = String(b.title ?? "").trim();
  if (!title) return { ok: false, error: "제목을 입력하세요." };
  if (title.length > TITLE_MAX) return { ok: false, error: `제목은 ${TITLE_MAX}자 이하여야 합니다.` };
  const content = String(b.content ?? "").trim();
  if (!content) return { ok: false, error: "내용을 입력하세요." };
  if (content.length > CONTENT_MAX) return { ok: false, error: `내용은 ${CONTENT_MAX}자 이하여야 합니다.` };
  // 화면 경로는 앱 내부 경로만 허용 (외부 URL/스킴 주입 차단). 비면 빈 문자열.
  let page_path = String(b.page_path ?? "").trim();
  if (page_path && (!page_path.startsWith("/") || page_path.startsWith("//") || page_path.length > PAGE_PATH_MAX)) {
    page_path = "";
  }
  return { ok: true, value: { category: category as FeedbackCategory, title, content, page_path } };
}

/** 총괄의 처리(상태/우선순위/답변) 입력 검증. 지정된 필드만 반환한다. */
export function validateModeration(body: unknown):
  | { ok: true; value: { status?: FeedbackStatus; priority?: FeedbackPriority; admin_reply?: string } }
  | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: { status?: FeedbackStatus; priority?: FeedbackPriority; admin_reply?: string } = {};
  if (b.status !== undefined) {
    const s = String(b.status);
    if (!(FEEDBACK_STATUSES as readonly string[]).includes(s)) return { ok: false, error: "상태가 올바르지 않습니다." };
    out.status = s as FeedbackStatus;
  }
  if (b.priority !== undefined) {
    const p = String(b.priority);
    if (!(FEEDBACK_PRIORITIES as readonly string[]).includes(p)) return { ok: false, error: "우선순위가 올바르지 않습니다." };
    out.priority = p as FeedbackPriority;
  }
  if (b.admin_reply !== undefined) {
    const r = String(b.admin_reply).trim();
    if (r.length > REPLY_MAX) return { ok: false, error: `답변은 ${REPLY_MAX}자 이하여야 합니다.` };
    out.admin_reply = r;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: "변경할 항목이 없습니다." };
  return { ok: true, value: out };
}

export interface FeedbackOwnership {
  user_id: number | null;
  status: string;
}

/** 총괄만 상태/답변/우선순위를 바꿀 수 있다. */
export function canModerateFeedback(actor: Actor | null): boolean {
  return !!actor && actor.role === "admin";
}

/** 작성자 본인은 아직 '접수' 상태일 때만 내용을 고칠 수 있다(검토가 시작되면 잠금). 총괄은 항상. */
export function canEditFeedback(actor: Actor | null, row: FeedbackOwnership): boolean {
  if (!actor) return false;
  if (actor.role === "admin") return true;
  return row.user_id === actor.userId && row.status === "open";
}

/** 삭제 정책은 수정과 동일. */
export function canDeleteFeedback(actor: Actor | null, row: FeedbackOwnership): boolean {
  return canEditFeedback(actor, row);
}

/** 공감(투표)은 본인 글 제외, 인증된 모든 역할 가능. */
export function canVoteFeedback(actor: Actor | null, row: FeedbackOwnership): boolean {
  if (!actor) return false;
  return row.user_id !== actor.userId;
}

// ── 개선의견 알림 메일 본문 (순수 모듈) ──
// 접수 → 총괄 전원, 답변 → 작성자. 발송·수신자 조회는 feedback-notify.ts.
// 평문 메일(폐쇄망 사내 릴레이). 본문에는 의견 내용을 그대로 싣되 비밀값은 없다.
import { CATEGORY_LABELS, STATUS_LABELS, type FeedbackCategory, type FeedbackStatus } from "./feedback.ts";
import { absoluteUrl, type MailRelayConfig } from "./mail-config.ts";

export interface FeedbackMailSource {
  id: number;
  category: string;
  title: string;
  content: string;
  page_path: string;
  status: string;
  created_by: string;
  created_by_name: string;
  team_name: string | null;
  admin_reply: string;
  replied_by: string;
}

export interface MailContent {
  subject: string;
  text: string;
}

/** 제목 줄에 개행이 섞이면 메일 헤더가 깨지므로 한 줄로 접는다. */
function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

function categoryLabel(c: string): string {
  return CATEGORY_LABELS[c as FeedbackCategory] ?? c;
}

function statusLabel(s: string): string {
  return STATUS_LABELS[s as FeedbackStatus] ?? s;
}

function author(f: FeedbackMailSource): string {
  const name = f.created_by_name ? `${f.created_by_name} (${f.created_by})` : f.created_by;
  return f.team_name ? `${name} · ${f.team_name}` : name;
}

/** 새 의견 접수 → 총괄에게. */
export function newFeedbackMail(config: MailRelayConfig, f: FeedbackMailSource): MailContent {
  const lines = [
    "개선의견이 새로 접수되었습니다.",
    "",
    `유형   : ${categoryLabel(f.category)}`,
    `제목   : ${oneLine(f.title)}`,
    `작성자 : ${author(f)}`,
  ];
  if (f.page_path) lines.push(`화면   : ${f.page_path}`);
  lines.push("", f.content, "", `처리하기: ${absoluteUrl(config, "/feedback")}`);
  return {
    subject: `[자산관리] 개선의견 접수 — ${oneLine(f.title)}`,
    text: lines.join("\n"),
  };
}

/** 총괄 답변 등록/수정 → 작성자에게. */
export function feedbackReplyMail(config: MailRelayConfig, f: FeedbackMailSource): MailContent {
  const lines = [
    "보내주신 개선의견에 총괄 답변이 등록되었습니다.",
    "",
    `제목     : ${oneLine(f.title)}`,
    `처리상태 : ${statusLabel(f.status)}`,
    `답변자   : ${f.replied_by}`,
    "",
    "[답변]",
    f.admin_reply,
    "",
    "[보내주신 내용]",
    f.content,
    "",
    `확인하기: ${absoluteUrl(config, "/feedback?mine=1")}`,
  ];
  return {
    subject: `[자산관리] 개선의견 답변 — ${oneLine(f.title)}`,
    text: lines.join("\n"),
  };
}

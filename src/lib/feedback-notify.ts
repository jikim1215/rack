// ── 개선의견 메일 알림 (발송) ──
// 접수 → 활성 총괄 전원, 답변 → 작성자. 메일 릴레이(설정 → 메일)가 꺼져 있거나 미완비면 아무것도 하지 않는다.
// best-effort: 라우트는 응답을 메일 발송에 묶지 않고 띄워 보낸다(fire-and-forget). 실패는 서버 로그로만 남긴다
// — 접수·답변 저장 자체는 이미 성공했고, 화면에서도 같은 내용을 볼 수 있다.
import { getDb } from "@/lib/db";
import { loadMailRelayConfig, isEmailEnabled, sendEmail, type MailRelayConfig } from "@/lib/mailer";
import { validateEmail } from "@/lib/user-admin";
import { newFeedbackMail, feedbackReplyMail, type FeedbackMailSource, type MailContent } from "@/lib/feedback-mail";

type Source = FeedbackMailSource & { user_id: number | null };

function loadSource(id: number): Source | undefined {
  return getDb().prepare(`
    SELECT f.id, f.category, f.title, f.content, f.page_path, f.status, f.created_by, f.created_by_name,
           f.admin_reply, f.replied_by, f.user_id, t.team_name
    FROM feedback f LEFT JOIN teams t ON f.team_id = t.id WHERE f.id = ?
  `).get(id) as Source | undefined;
}

async function sendAll(config: MailRelayConfig, kind: string, id: number, to: string[], mail: MailContent): Promise<void> {
  const results = await Promise.allSettled(to.map((addr) => sendEmail(config, { to: addr, ...mail })));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.warn(`[feedback-mail] ${kind} #${id} → ${to[i]} 발송 실패: ${reason}`);
    }
  });
}

/** 새 의견 접수 → 활성 총괄 전원(작성자 본인 제외). 로그인 ID 가 이메일 형식인 계정만. */
export async function notifyFeedbackCreated(id: number): Promise<void> {
  const config = loadMailRelayConfig();
  if (!isEmailEnabled(config)) return;
  const f = loadSource(id);
  if (!f) return;
  const admins = (getDb().prepare(
    "SELECT id, username FROM users WHERE role = 'admin' AND is_active = 1",
  ).all() as { id: number; username: string }[])
    .filter((u) => u.id !== f.user_id && validateEmail(u.username) === null)
    .map((u) => u.username);
  if (admins.length === 0) return;
  await sendAll(config, "접수", id, admins, newFeedbackMail(config, f));
}

/** 답변 등록/수정 → 작성자(활성 계정, 답변한 총괄 본인 제외). 작성자 계정이 삭제됐으면 보내지 않는다. */
export async function notifyFeedbackReplied(id: number, repliedByUserId: number): Promise<void> {
  const config = loadMailRelayConfig();
  if (!isEmailEnabled(config)) return;
  const f = loadSource(id);
  if (!f || !f.admin_reply || f.user_id == null || f.user_id === repliedByUserId) return;
  const user = getDb().prepare("SELECT username, is_active FROM users WHERE id = ?").get(f.user_id) as
    | { username: string; is_active: number }
    | undefined;
  if (!user || !user.is_active || validateEmail(user.username) !== null) return;
  await sendAll(config, "답변", id, [user.username], feedbackReplyMail(config, f));
}

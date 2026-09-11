export const dynamic = "force-dynamic";
import { requireMenuPage } from "@/lib/page-authz";
import { FeedbackView } from "./FeedbackView";

// 개선의견·불편사항 — 전 역할 열람/작성(메뉴 권한 'feedback'), 처리(상태·답변)는 총괄.
export default async function FeedbackPage() {
  const session = await requireMenuPage("feedback");
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <span className="eyebrow">FEEDBACK</span>
          <h2 className="text-2xl font-bold tracking-tight">개선의견 · 불편사항</h2>
          <p className="text-sm text-ink-3 mt-1">
            시스템을 쓰면서 겪은 불편·오류·개선 아이디어를 모읍니다. 같은 불편을 겪었다면 공감을 눌러 주세요 — 많이 모인 순으로 먼저 손봅니다.
          </p>
        </div>
      </div>
      <FeedbackView isAdmin={session.role === "admin"} userId={session.userId} />
    </div>
  );
}

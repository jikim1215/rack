"use client";

// 어느 화면에서든 '의견 보내기' — 사이드바 하단 버튼이 `asset:feedback-open` 이벤트를 쏘면 열린다.
// 현재 화면 경로(pathname+query)를 자동 첨부해 "어디서 불편했는지"가 같이 접수되게 한다.
// 접수·처리·삭제 등 변경 시 `asset:feedback-changed` 를 발행해 /feedback 목록과 사이드바 미처리 배지가 즉시 갱신된다.
import { useEffect, useState } from "react";
import { MessageSquarePlus, X } from "lucide-react";
import { useToast } from "@/components/Toast";
import { FeedbackForm, type FeedbackFormValue } from "@/components/FeedbackForm";

export const FEEDBACK_OPEN_EVENT = "asset:feedback-open";
export const FEEDBACK_CHANGED_EVENT = "asset:feedback-changed";

export function openFeedbackModal() {
  window.dispatchEvent(new Event(FEEDBACK_OPEN_EVENT));
}

export function notifyFeedbackChanged() {
  window.dispatchEvent(new Event(FEEDBACK_CHANGED_EVENT));
}

export function FeedbackModal() {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pagePath, setPagePath] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onOpen = () => {
      setPagePath(window.location.pathname + window.location.search);
      setOpen(true);
    };
    window.addEventListener(FEEDBACK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(FEEDBACK_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit(value: FeedbackFormValue) {
    setSaving(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { addToast(data.error || "접수에 실패했습니다.", "error"); return; }
      setOpen(false);
      notifyFeedbackChanged();
      addToast("의견이 접수되었습니다. 처리 상태는 개선의견 메뉴에서 확인할 수 있습니다.", "success", { label: "접수 내역 보기", href: "/feedback" });
    } catch {
      addToast("서버 연결에 실패했습니다.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="feedback-modal-title" className="panel w-full max-w-lg shadow-xl">
        <div className="panel-head justify-between">
          <div className="flex items-center gap-2">
            <MessageSquarePlus size={16} className="text-krds-primary-strong" />
            <h3 id="feedback-modal-title" className="text-sm font-semibold">불편사항 · 개선의견 보내기</h3>
          </div>
          <button onClick={() => setOpen(false)} className="text-ink-3 hover:text-ink" title="닫기"><X size={16} /></button>
        </div>
        <div className="p-5">
          <p className="text-xs text-ink-3 mb-3">
            쓰다가 막히거나 번거로운 점, 있었으면 하는 기능을 자유롭게 적어 주세요. 접수된 의견은 총괄이 검토해 처리 상태와 답변을 남깁니다.
          </p>
          <FeedbackForm
            key={pagePath}
            initial={{ category: "inconvenience", title: "", content: "", page_path: pagePath }}
            onSubmit={submit}
            onCancel={() => setOpen(false)}
            saving={saving}
          />
        </div>
      </div>
    </div>
  );
}

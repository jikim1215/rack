"use client";

import { useState } from "react";
import { CATEGORY_LABELS, CONTENT_MAX, FEEDBACK_CATEGORIES, TITLE_MAX, type FeedbackCategory } from "@/lib/feedback";

export interface FeedbackFormValue {
  category: FeedbackCategory;
  title: string;
  content: string;
  page_path: string;
}

const CATEGORY_HINT: Record<FeedbackCategory, string> = {
  bug: "동작이 잘못되거나 오류가 납니다 (재현 순서를 적어 주시면 빨리 고칩니다)",
  inconvenience: "되긴 하는데 번거롭거나 헷갈립니다",
  improvement: "이런 기능·화면이 있으면 좋겠습니다",
  question: "사용법이 궁금합니다",
  other: "그 외 의견",
};

/**
 * 개선의견 작성/수정 폼 — 사이드바 '의견 보내기' 모달과 /feedback 화면의 본인 글 수정에서 공용.
 * 제출 자체(POST/PATCH)는 호출부가 onSubmit 으로 담당하고, 이 컴포넌트는 입력·길이 안내·페이지 경로 표시만 맡는다.
 */
export function FeedbackForm({
  initial, onSubmit, onCancel, submitLabel = "보내기", saving = false,
}: {
  initial: FeedbackFormValue;
  onSubmit: (value: FeedbackFormValue) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  saving?: boolean;
}) {
  const [category, setCategory] = useState<FeedbackCategory>(initial.category);
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [pagePath, setPagePath] = useState(initial.page_path);

  const canSubmit = title.trim().length > 0 && content.trim().length > 0 && !saving;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) onSubmit({ category, title: title.trim(), content: content.trim(), page_path: pagePath.trim() }); }}
      className="space-y-3"
    >
      <div>
        <label className="block text-xs font-medium text-ink-2 mb-1">유형</label>
        <div className="flex flex-wrap gap-1.5">
          {FEEDBACK_CATEGORIES.map((c) => (
            <button
              key={c} type="button" onClick={() => setCategory(c)}
              className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                category === c ? "bg-ink text-white border-ink" : "border-line text-ink-2 hover:bg-slate-50"
              }`}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-3 mt-1">{CATEGORY_HINT[category]}</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-ink-2 mb-1">
          제목 <span className="text-ink-3 font-normal num">{title.length}/{TITLE_MAX}</span>
        </label>
        <input
          className="form-input" value={title} maxLength={TITLE_MAX} autoFocus
          placeholder="예) 자산관리 엑셀 업로드 후 어떤 행이 실패했는지 알기 어려움"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-ink-2 mb-1">
          내용 <span className="text-ink-3 font-normal num">{content.length}/{CONTENT_MAX}</span>
        </label>
        <textarea
          className="form-input min-h-[140px]" value={content} maxLength={CONTENT_MAX}
          placeholder={"어떤 상황에서 무엇이 불편했는지, 어떻게 되면 좋겠는지 적어 주세요.\n오류라면: 어떤 화면에서 → 무엇을 눌렀더니 → 어떻게 됐는지"}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-ink-2 mb-1">관련 화면 <span className="text-ink-3 font-normal">(자동 첨부 · 필요 시 수정)</span></label>
        <input
          className="form-input num text-xs" value={pagePath} placeholder="/assets"
          onChange={(e) => setPagePath(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-ink-2 hover:text-ink">취소</button>
        )}
        <button type="submit" disabled={!canSubmit} className="btn-ink disabled:opacity-50">
          {saving ? "저장 중…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

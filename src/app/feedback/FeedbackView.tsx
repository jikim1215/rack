"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ThumbsUp, Pencil, Trash2, MessageSquarePlus, Reply, ChevronDown, ChevronUp, Search } from "lucide-react";
import { useToast } from "@/components/Toast";
import { UsageGuide } from "@/components/UsageGuide";
import { FeedbackForm, type FeedbackFormValue } from "@/components/FeedbackForm";
import { FEEDBACK_CHANGED_EVENT, notifyFeedbackChanged, openFeedbackModal } from "@/components/FeedbackModal";
import {
  CATEGORY_LABELS, FEEDBACK_CATEGORIES, FEEDBACK_PRIORITIES, FEEDBACK_STATUSES,
  PRIORITY_LABELS, STATUS_LABELS,
  type FeedbackCategory, type FeedbackPriority, type FeedbackStatus,
} from "@/lib/feedback";

interface FeedbackRow {
  id: number;
  category: FeedbackCategory;
  title: string;
  content: string;
  page_path: string;
  status: FeedbackStatus;
  priority: FeedbackPriority;
  user_id: number | null;
  created_by: string;
  created_by_name: string;
  team_name: string | null;
  admin_reply: string;
  replied_by: string;
  replied_at: string;
  created_at: string;
  updated_at: string;
  votes: number;
  voted: number;
}

const statusColors: Record<FeedbackStatus, string> = {
  open: "bg-amber-50 text-warn",
  in_review: "bg-krds-primary-bg text-krds-primary-strong",
  planned: "bg-krds-primary-bg text-krds-primary-strong",
  done: "bg-signal/10 text-signal",
  rejected: "bg-slate-100 text-ink-3",
};
const categoryColors: Record<FeedbackCategory, string> = {
  bug: "bg-fault/10 text-fault",
  inconvenience: "bg-amber-50 text-warn",
  improvement: "bg-signal/10 text-signal",
  question: "bg-slate-100 text-ink-2",
  other: "bg-slate-100 text-ink-3",
};

const PAGE_SIZE = 30;
const CLAMP_LEN = 240;
const outlineBtn = "rounded-md border border-line text-sm text-ink-2 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent";

export function FeedbackView({ isAdmin, userId }: { isAdmin: boolean; userId: number }) {
  const { addToast } = useToast();
  const [status, setStatus] = useState<string>("active");
  const [category, setCategory] = useState("");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [sort, setSort] = useState<"recent" | "votes">("recent");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [total, setTotal] = useState(0);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [moderatingId, setModeratingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), sort });
      if (status) qs.set("status", status);
      if (category) qs.set("category", category);
      if (mine) qs.set("mine", "1");
      if (q) qs.set("q", q);
      const res = await fetch(`/api/feedback?${qs.toString()}`);
      if (!res.ok) { addToast("목록을 불러오지 못했습니다.", "error"); return; }
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setByStatus(data.byStatus ?? {});
    } finally {
      setLoading(false);
    }
  }, [status, category, mine, q, sort, page, addToast]);

  useEffect(() => { load(); }, [load]);
  // 모달 접수 등 외부 변경 시 재조회 (자기가 발행한 이벤트도 들어오지만 재조회 1회로 무해)
  useEffect(() => {
    window.addEventListener(FEEDBACK_CHANGED_EVENT, load);
    return () => window.removeEventListener(FEEDBACK_CHANGED_EVENT, load);
  }, [load]);

  function patchRow(updated: FeedbackRow) {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function toggleVote(row: FeedbackRow) {
    const res = await fetch(`/api/feedback/${row.id}/vote`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { addToast(data.error || "처리에 실패했습니다.", "error"); return; }
    patchRow({ ...row, votes: data.votes, voted: data.voted ? 1 : 0 });
  }

  async function saveEdit(row: FeedbackRow, value: FeedbackFormValue) {
    setSaving(true);
    try {
      const res = await fetch(`/api/feedback/${row.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { addToast(data.error || "수정에 실패했습니다.", "error"); return; }
      patchRow(data);
      setEditingId(null);
      addToast("의견을 수정했습니다.", "success");
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: FeedbackRow) {
    if (!confirm(`#${row.id} "${row.title}" 의견을 삭제할까요?`)) return;
    const res = await fetch(`/api/feedback/${row.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { addToast(data.error || "삭제에 실패했습니다.", "error"); return; }
    addToast(`#${row.id} 삭제됨`, "success");
    notifyFeedbackChanged();
  }

  async function moderate(row: FeedbackRow, patch: { status?: FeedbackStatus; priority?: FeedbackPriority; admin_reply?: string }) {
    setSaving(true);
    try {
      const res = await fetch(`/api/feedback/${row.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { addToast(data.error || "처리에 실패했습니다.", "error"); return; }
      patchRow(data);
      setModeratingId(null);
      addToast(`#${row.id} → ${STATUS_LABELS[data.status as FeedbackStatus]}`, "success");
      // 상태 칩 집계·사이드바 미처리 배지 갱신 (현재 필터에서 빠질 수 있으므로 재조회)
      notifyFeedbackChanged();
    } finally {
      setSaving(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pager = total > PAGE_SIZE && (
    <span className="inline-flex items-center gap-2 text-sm text-ink-2">
      <button className={`${outlineBtn} px-2 py-1`} disabled={page <= 0} onClick={() => setPage(page - 1)}>이전</button>
      <span className="num">{page + 1} / {pages}</span>
      <button className={`${outlineBtn} px-2 py-1`} disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>다음</button>
    </span>
  );

  const activeCount = (byStatus.open || 0) + (byStatus.in_review || 0) + (byStatus.planned || 0);
  const allCount = Object.values(byStatus).reduce((s, n) => s + n, 0);
  const chips: { key: string; label: string; count: number }[] = [
    { key: "active", label: "진행중", count: activeCount },
    ...FEEDBACK_STATUSES.map((s) => ({ key: s, label: STATUS_LABELS[s], count: byStatus[s] || 0 })),
    { key: "", label: "전체", count: allCount },
  ];

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <UsageGuide
          items={[
            <>어느 화면에서든 좌측 하단 <strong className="text-ink-2">불편사항 · 개선의견 보내기</strong>를 누르면 그 화면 경로가 자동으로 첨부돼 접수됩니다</>,
            <>같은 불편을 겪었다면 <strong className="text-ink-2">공감</strong>을 눌러 주세요 — 공감이 많은 의견부터 우선 검토합니다 (본인 글은 공감 불가)</>,
            <>본인 의견은 <strong className="text-ink-2">접수</strong> 상태일 때만 수정·삭제할 수 있습니다. 검토가 시작되면 잠깁니다</>,
            <>처리 흐름: 접수 → 검토중 → 반영예정 → 반영완료 (또는 보류). 총괄이 상태와 답변을 남기면 이 화면에서 확인할 수 있습니다</>,
          ]}
        />
        <button onClick={openFeedbackModal} className="btn-ink shrink-0">
          <MessageSquarePlus size={15} /> 의견 보내기
        </button>
      </div>

      {/* 상태 칩 */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {chips.map((c) => (
          <button
            key={c.key || "all"}
            onClick={() => { setStatus(c.key); setPage(0); }}
            className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
              status === c.key ? "bg-ink text-white border-ink" : "border-line text-ink-2 hover:bg-slate-50"
            }`}
          >
            {c.label} <span className="num opacity-80">{c.count}</span>
          </button>
        ))}
      </div>

      {/* 필터바 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select className="form-input !w-auto text-sm" value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }}>
          <option value="">전체 유형</option>
          {FEEDBACK_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
        <select className="form-input !w-auto text-sm" value={sort} onChange={(e) => { setSort(e.target.value as "recent" | "votes"); setPage(0); }}>
          <option value="recent">최신순</option>
          <option value="votes">공감순</option>
        </select>
        <label className="inline-flex items-center gap-1.5 text-sm text-ink-2 cursor-pointer">
          <input type="checkbox" className="accent-signal" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(0); }} />
          내 의견만
        </label>
        <form onSubmit={(e) => { e.preventDefault(); setQ(qInput.trim()); setPage(0); }} className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input className="form-input !w-56 pl-8 text-sm" placeholder="제목·내용·화면 검색" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </form>
        <button onClick={load} disabled={loading} className={`${outlineBtn} px-3 py-2 inline-flex items-center gap-1.5`}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> 새로고침
        </button>
        <span className="text-sm text-ink-3">총 <span className="num">{total}</span>건</span>
        <span className="ml-auto">{pager}</span>
      </div>

      {/* 목록 */}
      <div className="space-y-3">
        {rows.map((r) => {
          const isOwner = r.user_id === userId;
          const canEdit = isAdmin || (isOwner && r.status === "open");
          const isLong = r.content.length > CLAMP_LEN;
          const isExpanded = expanded.has(r.id);
          const shown = isLong && !isExpanded ? r.content.slice(0, CLAMP_LEN) + "…" : r.content;

          if (editingId === r.id) {
            return (
              <div key={r.id} className="panel p-5">
                <p className="eyebrow mb-3">#{r.id} 수정</p>
                <FeedbackForm
                  initial={{ category: r.category, title: r.title, content: r.content, page_path: r.page_path }}
                  onSubmit={(v) => saveEdit(r, v)}
                  onCancel={() => setEditingId(null)}
                  submitLabel="저장"
                  saving={saving}
                />
              </div>
            );
          }

          return (
            <div key={r.id} className="panel p-5">
              <div className="flex items-start gap-4">
                {/* 공감 */}
                <button
                  onClick={() => toggleVote(r)}
                  disabled={isOwner}
                  title={isOwner ? "본인 의견에는 공감할 수 없습니다" : r.voted ? "공감 취소" : "나도 겪었어요"}
                  className={`shrink-0 flex flex-col items-center justify-center w-12 h-14 rounded-lg border text-xs transition-colors ${
                    r.voted ? "bg-krds-primary-bg border-krds-primary text-krds-primary-strong" : "border-line text-ink-2 hover:bg-slate-50"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <ThumbsUp size={14} />
                  <span className="num font-semibold mt-0.5">{r.votes}</span>
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${categoryColors[r.category]}`}>{CATEGORY_LABELS[r.category]}</span>
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${statusColors[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                    {r.priority !== "normal" && (
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${r.priority === "high" ? "bg-fault/10 text-fault" : "bg-slate-100 text-ink-3"}`}>
                        우선순위 {PRIORITY_LABELS[r.priority]}
                      </span>
                    )}
                    <span className="text-xs text-ink-3 num">#{r.id}</span>
                  </div>
                  <h3 className="text-sm font-semibold text-ink break-words">{r.title}</h3>
                  <p className="text-[11px] text-ink-3 mt-0.5">
                    {r.created_by_name || r.created_by || "(삭제된 계정)"}
                    {r.team_name ? ` · ${r.team_name}` : ""}
                    {" · "}<span className="num">{r.created_at?.slice(0, 16)}</span>
                    {r.page_path && (
                      <> · 화면 <a href={r.page_path} className="num underline hover:text-ink">{r.page_path}</a></>
                    )}
                  </p>
                  <p className="text-sm text-ink-2 mt-2 whitespace-pre-wrap break-words">{shown}</p>
                  {isLong && (
                    <button
                      onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                      className="text-xs text-ink-3 hover:text-ink inline-flex items-center gap-0.5 mt-1"
                    >
                      {isExpanded ? <><ChevronUp size={12} /> 접기</> : <><ChevronDown size={12} /> 더 보기</>}
                    </button>
                  )}

                  {r.admin_reply && (
                    <div className="mt-3 border-l-2 border-krds-primary pl-3">
                      <p className="text-[11px] text-krds-primary-strong font-medium inline-flex items-center gap-1">
                        <Reply size={11} /> 총괄 답변 · {r.replied_by} · <span className="num">{r.replied_at?.slice(0, 16)}</span>
                      </p>
                      <p className="text-sm text-ink-2 mt-1 whitespace-pre-wrap break-words">{r.admin_reply}</p>
                    </div>
                  )}

                  {isAdmin && moderatingId === r.id && (
                    <ModerationForm row={r} saving={saving} onCancel={() => setModeratingId(null)} onSave={(p) => moderate(r, p)} />
                  )}
                </div>

                {/* 액션 */}
                <div className="shrink-0 flex flex-col items-end gap-1">
                  {isAdmin && moderatingId !== r.id && (
                    <button onClick={() => setModeratingId(r.id)} className="px-2 py-1 rounded text-xs bg-krds-primary-bg text-krds-primary-strong hover:bg-krds-primary/20 inline-flex items-center gap-1">
                      <Reply size={12} /> 처리
                    </button>
                  )}
                  {canEdit && (
                    <>
                      <button onClick={() => setEditingId(r.id)} className="px-2 py-1 rounded text-xs border border-line text-ink-2 hover:bg-slate-100 inline-flex items-center gap-1">
                        <Pencil size={12} /> 수정
                      </button>
                      <button onClick={() => remove(r)} className="px-2 py-1 rounded text-xs text-fault hover:bg-fault/10 inline-flex items-center gap-1">
                        <Trash2 size={12} /> 삭제
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && !loading && (
          <div className="panel p-10 text-center text-ink-3 text-sm">
            해당 조건의 의견이 없습니다.
            <div className="mt-3">
              <button onClick={openFeedbackModal} className="text-krds-primary-strong hover:underline text-sm inline-flex items-center gap-1">
                <MessageSquarePlus size={14} /> 첫 의견 보내기
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 text-right">{pager}</div>
    </div>
  );
}

function ModerationForm({
  row, saving, onCancel, onSave,
}: {
  row: FeedbackRow;
  saving: boolean;
  onCancel: () => void;
  onSave: (patch: { status: FeedbackStatus; priority: FeedbackPriority; admin_reply: string }) => void;
}) {
  const [status, setStatus] = useState<FeedbackStatus>(row.status);
  const [priority, setPriority] = useState<FeedbackPriority>(row.priority);
  const [reply, setReply] = useState(row.admin_reply);
  return (
    <div className="mt-3 border border-line rounded-lg p-3 bg-surface space-y-2">
      <p className="eyebrow">처리</p>
      <div className="flex flex-wrap gap-2">
        <select className="form-input !w-auto text-sm" value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus)}>
          {FEEDBACK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select className="form-input !w-auto text-sm" value={priority} onChange={(e) => setPriority(e.target.value as FeedbackPriority)}>
          {FEEDBACK_PRIORITIES.map((p) => <option key={p} value={p}>우선순위 {PRIORITY_LABELS[p]}</option>)}
        </select>
      </div>
      <textarea
        className="form-input min-h-[80px] text-sm" value={reply} maxLength={4000}
        placeholder="작성자에게 남길 답변 (선택) — 반영 계획, 대안 안내, 보류 사유 등"
        onChange={(e) => setReply(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-ink-2 hover:text-ink">취소</button>
        <button onClick={() => onSave({ status, priority, admin_reply: reply })} disabled={saving} className="btn-ink !py-1.5 disabled:opacity-50">
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}

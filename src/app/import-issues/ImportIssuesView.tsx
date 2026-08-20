"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, CheckCircle, EyeOff, RotateCcw } from "lucide-react";
import { useToast } from "@/components/Toast";
import { UsageGuide } from "@/components/UsageGuide";

interface IssueRow {
  id: number;
  batch_id: string;
  source_row: number | null;
  asset_id: number | null;
  asset_name: string | null;
  issue_type: string;
  raw_value: string;
  parsed_value: string;
  note: string;
  status: "open" | "resolved" | "ignored";
  resolved_by: string;
  resolved_at: string;
  created_by: string;
  created_at: string;
}

interface BatchSummary { batch_id: string; c: number; uploaded_at: string; uploaded_by: string }

const typeLabels: Record<string, string> = {
  ip_format: "IP 형식 오류",
  missing_id: "식별자 없음",
  missing_os: "OS 미입력",
  dup_suspect: "중복 의심",
};

const statusLabels: Record<string, string> = { open: "미조치", resolved: "조치완료", ignored: "무시" };
const statusColors: Record<string, string> = {
  open: "bg-amber-50 text-warn",
  resolved: "bg-signal/10 text-signal",
  ignored: "bg-slate-100 text-ink-3",
};

const PAGE_SIZE = 50;

export function ImportIssuesView() {
  const { addToast } = useToast();
  const [status, setStatus] = useState("open");
  const [issueType, setIssueType] = useState("");
  const [batch, setBatch] = useState("");
  const [rows, setRows] = useState<IssueRow[]>([]);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ status, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (issueType) qs.set("issue_type", issueType);
      if (batch) qs.set("batch", batch);
      const res = await fetch(`/api/import-issues?${qs.toString()}`);
      if (!res.ok) { addToast("목록을 불러오지 못했습니다.", "error"); return; }
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setBatches(data.batches ?? []);
    } finally {
      setLoading(false);
    }
  }, [status, issueType, batch, page, addToast]);

  useEffect(() => { load(); }, [load]);

  async function setIssueStatus(row: IssueRow, next: string) {
    const res = await fetch("/api/import-issues", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, status: next }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      addToast(data.error || "처리에 실패했습니다.", "error");
      return;
    }
    addToast(`#${row.id} → ${statusLabels[next]}`, "success");
    load();
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pager = total > PAGE_SIZE && (
    <span className="inline-flex items-center gap-2 text-sm text-ink-2">
      <button className="btn px-2 py-1 disabled:opacity-40" disabled={page <= 0} onClick={() => setPage(page - 1)}>이전</button>
      <span className="num">{page + 1} / {pages}</span>
      <span className="text-xs text-ink-3">{PAGE_SIZE}건씩</span>
      <button className="btn px-2 py-1 disabled:opacity-40" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>다음</button>
    </span>
  );

  return (
    <div>
      <UsageGuide
        className="mb-3 text-right"
        items={[
          <>정리큐는 엑셀 가져오기 때 <strong className="text-ink-2">차단하지 않고 분리 수집</strong>한 이상값입니다 — 원본 행은 자산으로 등록돼 있고, 이상값만 여기 남습니다</>,
          <>값을 고쳤다면 <strong className="text-ink-2">조치완료</strong>, 실제로 문제가 아니면 <strong className="text-ink-2">무시</strong>로 큐에서 내립니다 (잘못 처리했으면 재오픈)</>,
          <>값 자체의 수정은 자산명을 눌러 <strong className="text-ink-2">자산관리에서</strong> 합니다 — 이 화면은 처리 상태만 관리합니다</>,
          <>배치 필터로 특정 업로드에서 생긴 이슈만 모아 볼 수 있습니다 (업로드 시각·업로더 표시)</>,
        ]}
      />
      {/* 필터바 + 우측 페이저 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select className="form-input !w-auto text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
          <option value="open">미조치</option>
          <option value="resolved">조치완료</option>
          <option value="ignored">무시</option>
        </select>
        <select className="form-input !w-auto text-sm" value={issueType} onChange={(e) => { setIssueType(e.target.value); setPage(0); }}>
          <option value="">전체 유형</option>
          {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="form-input !w-auto text-sm num" value={batch} onChange={(e) => { setBatch(e.target.value); setPage(0); }}>
          <option value="">전체 배치</option>
          {batches.map((b) => (
            <option key={b.batch_id} value={b.batch_id}>
              {b.batch_id} — {b.uploaded_at?.slice(0, 16)}{b.uploaded_by ? ` · ${b.uploaded_by}` : ""} ({b.c}건)
            </option>
          ))}
        </select>
        <button onClick={load} disabled={loading} className="btn inline-flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> 새로고침
        </button>
        <span className="text-sm text-ink-3">총 <span className="num">{total}</span>건</span>
        <span className="ml-auto">{pager}</span>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-3 border-b border-line">
              <th className="p-3">배치 / 업로더</th>
              <th className="p-3">행</th>
              <th className="p-3">유형</th>
              <th className="p-3">자산</th>
              <th className="p-3">원본값</th>
              <th className="p-3">비고</th>
              <th className="p-3">상태</th>
              <th className="p-3">처리</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 align-top">
                <td className="p-3 text-xs text-ink-3">
                  <span className="num">{r.batch_id}</span>
                  <div>{r.created_at?.slice(0, 16)}{r.created_by ? ` · ${r.created_by}` : ""}</div>
                </td>
                <td className="p-3 num text-xs text-ink-3">{r.source_row ?? "-"}</td>
                <td className="p-3 text-xs font-medium text-warn whitespace-nowrap">{typeLabels[r.issue_type] || r.issue_type}</td>
                <td className="p-3 text-xs">
                  {r.asset_id ? (
                    <a href={`/assets?q=${encodeURIComponent(r.asset_name || "")}`} className="text-ink hover:underline">{r.asset_name}</a>
                  ) : (
                    <span className="text-ink-3">(자산 삭제됨)</span>
                  )}
                </td>
                <td className="p-3 text-xs text-ink-3 max-w-[180px] truncate" title={r.raw_value}>{r.raw_value || "-"}</td>
                <td className="p-3 text-xs text-ink-3 max-w-[160px] truncate" title={r.note}>{r.note || "-"}</td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${statusColors[r.status]}`}>{statusLabels[r.status]}</span>
                  {r.status !== "open" && r.resolved_by && (
                    <div className="text-[10px] text-ink-3 mt-0.5">{r.resolved_by} · {r.resolved_at?.slice(0, 16)}</div>
                  )}
                </td>
                <td className="p-3 whitespace-nowrap">
                  {r.status === "open" ? (
                    <span className="inline-flex gap-1">
                      <button onClick={() => setIssueStatus(r, "resolved")} title="조치완료로 처리"
                        className="px-2 py-1 rounded text-xs bg-signal/10 text-signal hover:bg-signal/20 inline-flex items-center gap-1">
                        <CheckCircle size={12} /> 조치완료
                      </button>
                      <button onClick={() => setIssueStatus(r, "ignored")} title="문제 아님 — 큐에서 내림"
                        className="px-2 py-1 rounded text-xs bg-slate-100 text-ink-2 hover:bg-slate-200 inline-flex items-center gap-1">
                        <EyeOff size={12} /> 무시
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => setIssueStatus(r, "open")} title="미조치로 되돌리기"
                      className="px-2 py-1 rounded text-xs border border-line text-ink-2 hover:bg-slate-100 inline-flex items-center gap-1">
                      <RotateCcw size={12} /> 재오픈
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={8} className="p-8 text-center text-ink-3">해당 조건의 이슈가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-right">{pager}</div>
    </div>
  );
}

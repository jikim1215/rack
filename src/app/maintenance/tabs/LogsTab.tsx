"use client";

// 유지관리내역(장애/유지보수/점검) 목록 · 등록 · 상태변경 · 삭제 탭
import { useState } from "react";
import { Wrench, Plus, X, Search } from "lucide-react";
import { LogForm } from "./LogForm";
import {
  emptyForm,
  statusColors,
  statusLabels,
  statusLed,
  typeColors,
  typeIcons,
  typeLabels,
  severityColors,
  severityLabels,
} from "./types";
import type { AssetOption, Log, VendorOption } from "./types";

interface Props {
  logs: Log[];
  onLogsChange: (logs: Log[]) => void;
  assets: AssetOption[];
  vendors: VendorOption[];
}

export function LogsTab({ logs, onLogsChange, assets, vendors }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = logs.filter((l) => {
    if (typeFilter && l.log_type !== typeFilter) return false;
    if (severityFilter && l.severity !== severityFilter) return false;
    if (statusFilter && l.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        (l.asset_name || "").toLowerCase().includes(s) ||
        l.symptom.toLowerCase().includes(s) ||
        l.reported_by.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const counts = {
    open: logs.filter((l) => l.status === "open").length,
    in_progress: logs.filter((l) => l.status === "in_progress").length,
    resolved: logs.filter((l) => l.status === "resolved").length,
  };

  async function handleSubmit() {
    if (!form.asset_id) return alert("자산을 선택하세요.");
    const res = await fetch("/api/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        asset_id: Number(form.asset_id),
        vendor_id: form.vendor_id ? Number(form.vendor_id) : null,
      }),
    });
    if (res.ok) {
      const created: Log = await res.json();
      onLogsChange([created, ...logs]);
      setForm(emptyForm);
      setShowForm(false);
    } else {
      // 서버 검증 메시지(400: 어떤 필드가 왜 거부됐는지)를 그대로 보여준다 (비평 반영)
      const data = await res.json().catch(() => ({}));
      alert(data.error || "저장에 실패했습니다.");
    }
  }

  async function handleStatus(id: number, status: string) {
    const res = await fetch(`/api/maintenance/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated: Log = await res.json();
      onLogsChange(logs.map((l) => (l.id === id ? updated : l)));
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("삭제하시겠습니까?")) return;
    const res = await fetch(`/api/maintenance/${id}`, { method: "DELETE" });
    if (res.ok) onLogsChange(logs.filter((l) => l.id !== id));
  }

  return (
    <div className="space-y-4">
      {/* 통계 */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "미해결", value: counts.open, color: "text-fault" },
          { label: "진행중", value: counts.in_progress, color: "text-warn" },
          { label: "해결", value: counts.resolved, color: "text-signal" },
        ].map((s) => (
          <div key={s.label} className="panel p-3 text-center">
            <div className={`num text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="eyebrow">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 필터 + 등록 버튼 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-3" />
          <input
            className="form-input w-full pl-8 pr-3 py-2 text-sm"
            placeholder="자산명, 증상, 보고자 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="form-input px-3 py-2 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">유형 전체</option>
          <option value="failure">장애</option>
          <option value="maintenance">유지보수</option>
          <option value="inspection">점검</option>
        </select>
        <select className="form-input px-3 py-2 text-sm" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
          <option value="">심각도 전체</option>
          <option value="critical">심각</option>
          <option value="major">주요</option>
          <option value="minor">경미</option>
        </select>
        <select className="form-input px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">상태 전체</option>
          <option value="open">미해결</option>
          <option value="in_progress">진행중</option>
          <option value="resolved">해결</option>
        </select>
        <button
          className="btn-ink flex items-center gap-1 px-4 py-2 text-sm"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? "취소" : "등록"}
        </button>
      </div>

      {/* 등록 폼 */}
      {showForm && (
        <LogForm form={form} onChange={setForm} assets={assets} vendors={vendors} onSubmit={handleSubmit} />
      )}

      {/* 테이블 */}
      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel border-b border-line">
            <tr>
              <th className="text-left px-3 py-2 eyebrow">자산명</th>
              <th className="text-left px-3 py-2 eyebrow">유형</th>
              <th className="text-left px-3 py-2 eyebrow">심각도</th>
              <th className="text-left px-3 py-2 eyebrow">증상</th>
              <th className="text-left px-3 py-2 eyebrow">상태</th>
              <th className="text-left px-3 py-2 eyebrow">발생일</th>
              <th className="text-left px-3 py-2 eyebrow">처리자</th>
              <th className="text-left px-3 py-2 eyebrow">관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-ink-3">등록된 이력이 없습니다.</td></tr>
            )}
            {filtered.map((l) => {
              const TypeIcon = typeIcons[l.log_type] || Wrench;
              return (
                <tr key={l.id} className="border-b border-line hover:bg-slate-100">
                  <td className="px-3 py-2 font-medium">{l.asset_name || "-"}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${typeColors[l.log_type] || ""}`}>
                      <TypeIcon className="h-3 w-3" />
                      {typeLabels[l.log_type] || l.log_type}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${severityColors[l.severity] || ""}`}>
                      {severityLabels[l.severity] || l.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2 max-w-[200px] truncate" title={l.symptom}>{l.symptom || "-"}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center font-medium ${statusColors[l.status] || ""}`}>
                      <span className={`led ${statusLed[l.status] || "led-idle"}`} />
                      {statusLabels[l.status] || l.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 num text-ink-3">{l.occurred_at ? l.occurred_at.slice(0, 10) : "-"}</td>
                  <td className="px-3 py-2 text-ink-3">{l.handled_by || l.reported_by || "-"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {l.status === "open" && (
                        <button
                          className="px-2 py-1 bg-amber-50 text-warn rounded text-xs hover:bg-amber-100"
                          onClick={() => handleStatus(l.id, "in_progress")}
                        >진행</button>
                      )}
                      {(l.status === "open" || l.status === "in_progress") && (
                        <button
                          className="px-2 py-1 bg-green-50 text-signal rounded text-xs hover:bg-green-100"
                          onClick={() => handleStatus(l.id, "resolved")}
                        >해결</button>
                      )}
                      <button
                        className="px-2 py-1 text-fault rounded text-xs hover:bg-red-50"
                        onClick={() => handleDelete(l.id)}
                      >삭제</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

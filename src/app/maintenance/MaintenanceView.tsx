"use client";

import { useState } from "react";
import { Wrench, AlertTriangle, ClipboardCheck, Plus, X, Search } from "lucide-react";

interface Log {
  id: number;
  asset_id: number;
  asset_name: string | null;
  log_type: string;
  occurred_at: string;
  resolved_at: string;
  reported_by: string;
  handled_by: string;
  severity: string;
  symptom: string;
  action_taken: string;
  vendor_id: number | null;
  vendor_name: string | null;
  cost: string;
  status: string;
  notes: string;
}

const typeLabels: Record<string, string> = { failure: "장애", maintenance: "유지보수", inspection: "점검" };
const typeColors: Record<string, string> = {
  failure: "bg-red-100 text-red-700",
  maintenance: "bg-blue-100 text-blue-700",
  inspection: "bg-green-100 text-green-700",
};
const typeIcons: Record<string, typeof AlertTriangle> = {
  failure: AlertTriangle, maintenance: Wrench, inspection: ClipboardCheck,
};
const severityLabels: Record<string, string> = { critical: "심각", major: "주요", minor: "경미" };
const severityColors: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  major: "bg-amber-100 text-amber-700",
  minor: "bg-blue-100 text-blue-700",
};
const statusLabels: Record<string, string> = { open: "미해결", in_progress: "진행중", resolved: "해결" };
const statusColors: Record<string, string> = {
  open: "text-red-600", in_progress: "text-amber-600", resolved: "text-green-600",
};

const emptyForm = {
  asset_id: "",
  log_type: "failure",
  severity: "minor",
  occurred_at: "",
  symptom: "",
  action_taken: "",
  vendor_id: "",
  cost: "",
  notes: "",
};

interface Props {
  logs: Log[];
  assets: { id: number; asset_name: string }[];
  vendors: { id: number; vendor_name: string }[];
}

export default function MaintenanceView({ logs: initialLogs, assets, vendors }: Props) {
  const [logs, setLogs] = useState(initialLogs);
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
    failure: logs.filter((l) => l.log_type === "failure").length,
    inspection: logs.filter((l) => l.log_type === "inspection").length,
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
      const created = await res.json();
      setLogs([created, ...logs]);
      setForm(emptyForm);
      setShowForm(false);
    }
  }

  async function handleStatus(id: number, status: string) {
    const res = await fetch(`/api/maintenance/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated = await res.json();
      setLogs(logs.map((l) => (l.id === id ? updated : l)));
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("삭제하시겠습니까?")) return;
    const res = await fetch(`/api/maintenance/${id}`, { method: "DELETE" });
    if (res.ok) setLogs(logs.filter((l) => l.id !== id));
  }

  return (
    <div className="space-y-4">
      {/* 통계 */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "미해결", value: counts.open, color: "text-red-600", bg: "bg-red-50" },
          { label: "진행중", value: counts.in_progress, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "해결", value: counts.resolved, color: "text-green-600", bg: "bg-green-50" },
          { label: "장애", value: counts.failure, color: "text-red-600", bg: "bg-red-50" },
          { label: "점검", value: counts.inspection, color: "text-blue-600", bg: "bg-blue-50" },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} rounded-lg p-3 text-center`}>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-600">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 필터 + 등록 버튼 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="w-full pl-8 pr-3 py-2 border rounded-lg text-sm"
            placeholder="자산명, 증상, 보고자 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="border rounded-lg px-3 py-2 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">유형 전체</option>
          <option value="failure">장애</option>
          <option value="maintenance">유지보수</option>
          <option value="inspection">점검</option>
        </select>
        <select className="border rounded-lg px-3 py-2 text-sm" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
          <option value="">심각도 전체</option>
          <option value="critical">심각</option>
          <option value="major">주요</option>
          <option value="minor">경미</option>
        </select>
        <select className="border rounded-lg px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">상태 전체</option>
          <option value="open">미해결</option>
          <option value="in_progress">진행중</option>
          <option value="resolved">해결</option>
        </select>
        <button
          className="flex items-center gap-1 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? "취소" : "등록"}
        </button>
      </div>

      {/* 등록 폼 */}
      {showForm && (
        <div className="bg-white border rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">자산 *</label>
              <select className="w-full border rounded px-2 py-1.5 text-sm" value={form.asset_id} onChange={(e) => setForm({ ...form, asset_id: e.target.value })}>
                <option value="">선택</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>{a.asset_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">유형</label>
              <select className="w-full border rounded px-2 py-1.5 text-sm" value={form.log_type} onChange={(e) => setForm({ ...form, log_type: e.target.value })}>
                <option value="failure">장애</option>
                <option value="maintenance">유지보수</option>
                <option value="inspection">점검</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">심각도</label>
              <select className="w-full border rounded px-2 py-1.5 text-sm" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                <option value="critical">심각</option>
                <option value="major">주요</option>
                <option value="minor">경미</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">발생일시</label>
              <input type="datetime-local" className="w-full border rounded px-2 py-1.5 text-sm" value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">업체</label>
              <select className="w-full border rounded px-2 py-1.5 text-sm" value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}>
                <option value="">없음</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.vendor_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">비용</label>
              <input type="text" className="w-full border rounded px-2 py-1.5 text-sm" placeholder="예: 500,000원" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">증상</label>
            <textarea className="w-full border rounded px-2 py-1.5 text-sm" rows={2} value={form.symptom} onChange={(e) => setForm({ ...form, symptom: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">조치내용</label>
            <textarea className="w-full border rounded px-2 py-1.5 text-sm" rows={2} value={form.action_taken} onChange={(e) => setForm({ ...form, action_taken: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">비고</label>
            <input type="text" className="w-full border rounded px-2 py-1.5 text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex justify-end">
            <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700" onClick={handleSubmit}>등록</button>
          </div>
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-slate-600">자산명</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">유형</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">심각도</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">증상</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">상태</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">발생일</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">처리자</th>
              <th className="text-left px-3 py-2 font-medium text-slate-600">관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-slate-400">등록된 이력이 없습니다.</td></tr>
            )}
            {filtered.map((l) => {
              const TypeIcon = typeIcons[l.log_type] || Wrench;
              return (
                <tr key={l.id} className="border-b hover:bg-slate-50">
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
                    <span className={`font-medium ${statusColors[l.status] || ""}`}>
                      {statusLabels[l.status] || l.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{l.occurred_at ? l.occurred_at.slice(0, 10) : "-"}</td>
                  <td className="px-3 py-2 text-slate-500">{l.handled_by || l.reported_by || "-"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {l.status === "open" && (
                        <button
                          className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs hover:bg-amber-200"
                          onClick={() => handleStatus(l.id, "in_progress")}
                        >진행</button>
                      )}
                      {(l.status === "open" || l.status === "in_progress") && (
                        <button
                          className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200"
                          onClick={() => handleStatus(l.id, "resolved")}
                        >해결</button>
                      )}
                      <button
                        className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200"
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

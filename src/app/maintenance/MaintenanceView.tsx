"use client";

import { useMemo, useState } from "react";
import { Wrench, AlertTriangle, ClipboardCheck, Plus, X, Search, Pencil, Trash2, Coins, ListChecks, Download, Upload, ChevronsUpDown, ChevronUp, ChevronDown } from "lucide-react";

interface Log {
  id: number;
  asset_id: number | null;
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

interface Target {
  id: number;
  asset_id: number | null;
  asset_name: string | null;
  system_name: string;
  category: string;
  asset_type_label: string;
  resource_name: string;
  quantity: number;
  manufacturer: string;
  host_name: string;
  purpose: string;
  location_text: string;
  rack_position: string;
  asset_code: string;
  owner_department: string;
  owner_user: string;
  acquisition_date: string;
  acquisition_amount: string;
  maintenance_start: string;
  maintenance_end: string;
  maintenance_months: number;
  business_impact: string;
  data_importance: string;
  user_traffic: string;
  hardware_score: string;
  maintenance_difficulty: string;
  maintenance_scope: string;
  score_total: string;
  grade: string;
  rate: string;
  estimated_amount_calc: string;
  estimated_amount_input: string;
  evidence_note: string;
  notes: string;
  updated_at: string;
}

interface AssetOption {
  id: number;
  asset_name: string;
  asset_tag?: string;
  manufacturer?: string;
  model?: string;
}

const typeLabels: Record<string, string> = { failure: "장애", maintenance: "유지보수", inspection: "점검" };
const typeColors: Record<string, string> = {
  failure: "bg-red-50 text-fault",
  maintenance: "bg-slate-100 text-ink",
  inspection: "bg-green-50 text-signal",
};
const typeIcons: Record<string, typeof AlertTriangle> = {
  failure: AlertTriangle, maintenance: Wrench, inspection: ClipboardCheck,
};
const severityLabels: Record<string, string> = { critical: "심각", major: "주요", minor: "경미" };
const severityColors: Record<string, string> = {
  critical: "bg-red-50 text-fault",
  major: "bg-amber-50 text-warn",
  minor: "bg-slate-100 text-ink",
};
const statusLabels: Record<string, string> = { open: "미해결", in_progress: "진행중", resolved: "해결" };
const statusColors: Record<string, string> = {
  open: "text-fault", in_progress: "text-warn", resolved: "text-signal",
};
const statusLed: Record<string, string> = {
  open: "led-fault", in_progress: "led-warn", resolved: "led-up",
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

const emptyTarget = {
  asset_id: "",
  system_name: "",
  category: "",
  asset_type_label: "",
  resource_name: "",
  quantity: "1",
  manufacturer: "",
  host_name: "",
  purpose: "",
  location_text: "",
  rack_position: "",
  asset_code: "",
  owner_department: "",
  owner_user: "",
  acquisition_date: "",
  acquisition_amount: "",
  maintenance_start: "",
  maintenance_end: "",
  maintenance_months: "0",
  business_impact: "",
  data_importance: "",
  user_traffic: "",
  hardware_score: "",
  maintenance_difficulty: "",
  maintenance_scope: "",
  score_total: "",
  grade: "",
  rate: "",
  estimated_amount_calc: "",
  estimated_amount_input: "",
  evidence_note: "",
  notes: "",
};

type TargetForm = typeof emptyTarget;

function formatAmount(v: string) {
  if (!v) return "-";
  const n = Number(String(v).replace(/,/g, ""));
  if (!Number.isFinite(n) || n === 0) return v;
  return n.toLocaleString("ko-KR");
}

function targetToForm(t: Target): TargetForm {
  return {
    asset_id: t.asset_id != null ? String(t.asset_id) : "",
    system_name: t.system_name || "",
    category: t.category || "",
    asset_type_label: t.asset_type_label || "",
    resource_name: t.resource_name || "",
    quantity: String(t.quantity ?? 1),
    manufacturer: t.manufacturer || "",
    host_name: t.host_name || "",
    purpose: t.purpose || "",
    location_text: t.location_text || "",
    rack_position: t.rack_position || "",
    asset_code: t.asset_code || "",
    owner_department: t.owner_department || "",
    owner_user: t.owner_user || "",
    acquisition_date: t.acquisition_date || "",
    acquisition_amount: t.acquisition_amount || "",
    maintenance_start: t.maintenance_start || "",
    maintenance_end: t.maintenance_end || "",
    maintenance_months: String(t.maintenance_months ?? 0),
    business_impact: t.business_impact || "",
    data_importance: t.data_importance || "",
    user_traffic: t.user_traffic || "",
    hardware_score: t.hardware_score || "",
    maintenance_difficulty: t.maintenance_difficulty || "",
    maintenance_scope: t.maintenance_scope || "",
    score_total: t.score_total || "",
    grade: t.grade || "",
    rate: t.rate || "",
    estimated_amount_calc: t.estimated_amount_calc || "",
    estimated_amount_input: t.estimated_amount_input || "",
    evidence_note: t.evidence_note || "",
    notes: t.notes || "",
  };
}

interface Props {
  logs: Log[];
  targets: Target[];
  assets: AssetOption[];
  vendors: { id: number; vendor_name: string }[];
}

export default function MaintenanceView({ logs: initialLogs, targets: initialTargets, assets, vendors }: Props) {
  const [tab, setTab] = useState<"logs" | "targets">("logs");

  // ── 유지관리내역 (logs) ──
  const [logs, setLogs] = useState(initialLogs);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // ── 유지관리 대상/금액 (targets) ──
  const [targets, setTargets] = useState(initialTargets);
  const [showTargetForm, setShowTargetForm] = useState(false);
  const [targetForm, setTargetForm] = useState<TargetForm>(emptyTarget);
  const [editingTargetId, setEditingTargetId] = useState<number | null>(null);
  const [targetSearch, setTargetSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [targetSort, setTargetSort] = useState<{ key: "owner_department" | "grade" | "amount"; dir: "asc" | "desc" } | null>(null);

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

  const filteredTargets = useMemo(() => {
    const q = targetSearch.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((t) =>
      `${t.asset_name || ""} ${t.system_name} ${t.resource_name} ${t.asset_code} ${t.manufacturer} ${t.owner_department}`
        .toLowerCase()
        .includes(q)
    );
  }, [targets, targetSearch]);

  const amountOf = (t: Target) => {
    const n = Number(String(t.estimated_amount_input || t.estimated_amount_calc || "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const sortedTargets = useMemo(() => {
    if (!targetSort) return filteredTargets;
    const { key, dir } = targetSort;
    const sign = dir === "asc" ? 1 : -1;
    const arr = [...filteredTargets];
    arr.sort((a, b) => {
      let cmp = 0;
      if (key === "owner_department") {
        cmp = (a.owner_department || "").localeCompare(b.owner_department || "", "ko");
      } else if (key === "grade") {
        // 등급은 숫자(1~) 우선 비교, 비숫자는 문자열 비교
        const na = Number(a.grade), nb = Number(b.grade);
        cmp = Number.isFinite(na) && Number.isFinite(nb)
          ? na - nb
          : (a.grade || "").localeCompare(b.grade || "", "ko");
      } else {
        cmp = amountOf(a) - amountOf(b);
      }
      if (cmp === 0) cmp = a.id - b.id;
      return cmp * sign;
    });
    return arr;
  }, [filteredTargets, targetSort]);

  function toggleTargetSort(key: "owner_department" | "grade" | "amount") {
    setTargetSort((prev) =>
      prev && prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  }

  function SortIcon({ sortKey }: { sortKey: "owner_department" | "grade" | "amount" }) {
    if (!targetSort || targetSort.key !== sortKey) {
      return <ChevronsUpDown className="h-3.5 w-3.5 text-ink-3/50 group-hover:text-ink-3" />;
    }
    return targetSort.dir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-signal" />
      : <ChevronDown className="h-3.5 w-3.5 text-signal" />;
  }

  const targetTotals = useMemo(() => {
    const sum = targets.reduce((acc, t) => {
      const n = Number(String(t.estimated_amount_input || t.estimated_amount_calc || "").replace(/,/g, ""));
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
    const expiringSoon = targets.filter((t) => {
      if (!t.maintenance_end) return false;
      const endAt = Date.parse(t.maintenance_end);
      if (Number.isNaN(endAt)) return false;
      const diffDays = (endAt - Date.now()) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 60;
    }).length;
    return { total: targets.length, sum, expiringSoon };
  }, [targets]);

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
    } else {
      alert("저장에 실패했습니다.");
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

  function openTargetCreate() {
    setEditingTargetId(null);
    setTargetForm(emptyTarget);
    setShowTargetForm(true);
  }

  function openTargetEdit(t: Target) {
    setEditingTargetId(t.id);
    setTargetForm(targetToForm(t));
    setShowTargetForm(true);
  }

  function closeTargetForm() {
    setShowTargetForm(false);
    setEditingTargetId(null);
    setTargetForm(emptyTarget);
  }

  async function handleTargetSubmit() {
    if (!targetForm.resource_name.trim() && !targetForm.asset_id) {
      return alert("정보자원명을 입력하거나 자산을 선택하세요.");
    }
    const payload = {
      ...targetForm,
      record_kind: "target",
      asset_id: targetForm.asset_id ? Number(targetForm.asset_id) : null,
      quantity: Number(targetForm.quantity) || 1,
      maintenance_months: Number(targetForm.maintenance_months) || 0,
    };
    const url = editingTargetId ? `/api/maintenance/${editingTargetId}` : "/api/maintenance";
    const method = editingTargetId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const saved: Target = await res.json();
      if (editingTargetId) {
        setTargets(targets.map((t) => (t.id === saved.id ? saved : t)));
      } else {
        setTargets([saved, ...targets]);
      }
      closeTargetForm();
    } else {
      alert("저장에 실패했습니다.");
    }
  }

  async function handleTargetDelete(id: number) {
    if (!confirm("이 유지관리 대상 기록을 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/maintenance/${id}?record_kind=target`, { method: "DELETE" });
    if (res.ok) setTargets(targets.filter((t) => t.id !== id));
  }

  function setTF(patch: Partial<TargetForm>) {
    setTargetForm((f) => ({ ...f, ...patch }));
  }

  async function handleTargetImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const replace = confirm(
      "가져오기 방식을 선택하세요.\n\n확인 = 기존 유지관리 대상을 모두 지우고 교체\n취소 = 기존 목록에 추가"
    );
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("replace", replace ? "1" : "0");
      const res = await fetch("/api/maintenance/targets/import", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "가져오기에 실패했습니다.");
        return;
      }
      alert(`가져오기 완료: ${data.inserted}건 등록${data.skipped ? ` · ${data.skipped}건 스킵` : ""}${data.replaced ? " (기존 교체)" : ""}`);
      window.location.reload();
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 탭 */}
      <div className="flex border-b border-line">
        <button
          onClick={() => setTab("logs")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "logs" ? "border-signal text-ink" : "border-transparent text-ink-2 hover:text-ink"
          }`}
        >
          <span className="flex items-center gap-1.5"><ListChecks size={16} /> 유지관리내역</span>
        </button>
        <button
          onClick={() => setTab("targets")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "targets" ? "border-signal text-ink" : "border-transparent text-ink-2 hover:text-ink"
          }`}
        >
          <span className="flex items-center gap-1.5"><Coins size={16} /> 유지관리 대상/금액</span>
        </button>
      </div>

      {tab === "logs" && (
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
            <div className="panel p-4 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block eyebrow mb-1">자산 *</label>
                  <select className="form-input w-full px-2 py-1.5 text-sm" value={form.asset_id} onChange={(e) => setForm({ ...form, asset_id: e.target.value })}>
                    <option value="">선택</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>{a.asset_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block eyebrow mb-1">유형</label>
                  <select className="form-input w-full px-2 py-1.5 text-sm" value={form.log_type} onChange={(e) => setForm({ ...form, log_type: e.target.value })}>
                    <option value="failure">장애</option>
                    <option value="maintenance">유지보수</option>
                    <option value="inspection">점검</option>
                  </select>
                </div>
                <div>
                  <label className="block eyebrow mb-1">심각도</label>
                  <select className="form-input w-full px-2 py-1.5 text-sm" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                    <option value="critical">심각</option>
                    <option value="major">주요</option>
                    <option value="minor">경미</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block eyebrow mb-1">발생일시</label>
                  <input type="datetime-local" className="form-input w-full px-2 py-1.5 text-sm" value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} />
                </div>
                <div>
                  <label className="block eyebrow mb-1">업체</label>
                  <select className="form-input w-full px-2 py-1.5 text-sm" value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}>
                    <option value="">없음</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.vendor_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block eyebrow mb-1">비용</label>
                  <input type="text" className="form-input w-full px-2 py-1.5 text-sm" placeholder="예: 500,000원" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block eyebrow mb-1">증상</label>
                <textarea className="form-input w-full px-2 py-1.5 text-sm" rows={2} value={form.symptom} onChange={(e) => setForm({ ...form, symptom: e.target.value })} />
              </div>
              <div>
                <label className="block eyebrow mb-1">조치내용</label>
                <textarea className="form-input w-full px-2 py-1.5 text-sm" rows={2} value={form.action_taken} onChange={(e) => setForm({ ...form, action_taken: e.target.value })} />
              </div>
              <div>
                <label className="block eyebrow mb-1">비고</label>
                <input type="text" className="form-input w-full px-2 py-1.5 text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex justify-end">
                <button className="btn-ink px-4 py-2 text-sm" onClick={handleSubmit}>등록</button>
              </div>
            </div>
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
      )}

      {tab === "targets" && (
        <div className="space-y-4">
          {/* 통계 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="panel p-3 text-center">
              <div className="num text-2xl font-bold text-ink">{targetTotals.total}</div>
              <div className="eyebrow">유지관리 대상</div>
            </div>
            <div className="panel p-3 text-center">
              <div className="num text-2xl font-bold text-warn">{targetTotals.expiringSoon}</div>
              <div className="eyebrow">60일 내 종료</div>
            </div>
            <div className="panel p-3 text-center">
              <div className="num text-2xl font-bold text-signal">{formatAmount(String(targetTotals.sum))}</div>
              <div className="eyebrow">추정금액 합계(원)</div>
            </div>
          </div>

          {/* 검색 + 등록 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-3" />
              <input
                className="form-input w-full pl-8 pr-3 py-2 text-sm"
                placeholder="자산명, 시스템, 정보자원명, 자산코드 검색..."
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
              />
            </div>
            <button
              className="flex items-center gap-1 px-3 py-2 text-sm border border-line rounded-lg text-ink-2 hover:bg-slate-100"
              onClick={() => { window.location.href = "/api/maintenance/targets/export"; }}
            >
              <Download className="h-4 w-4" /> 익스포트
            </button>
            <label className="flex items-center gap-1 px-3 py-2 text-sm border border-line rounded-lg text-ink-2 hover:bg-slate-100 cursor-pointer">
              <Upload className="h-4 w-4" /> {importing ? "가져오는 중..." : "임포트"}
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                disabled={importing}
                onChange={handleTargetImport}
              />
            </label>
            <button className="btn-ink flex items-center gap-1 px-4 py-2 text-sm" onClick={openTargetCreate}>
              <Plus className="h-4 w-4" /> 대상 등록
            </button>
          </div>

          {/* 등록/수정 폼 */}
          {showTargetForm && (
            <div className="panel p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{editingTargetId ? "유지관리 대상 수정" : "유지관리 대상 등록"}</h3>
                <button className="text-ink-3 hover:text-ink" onClick={closeTargetForm}><X className="h-4 w-4" /></button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block eyebrow mb-1">연결 자산(선택)</label>
                  <select className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.asset_id} onChange={(e) => setTF({ asset_id: e.target.value })}>
                    <option value="">없음(수기 입력)</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>{a.asset_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block eyebrow mb-1">정보시스템명</label>
                  <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.system_name} onChange={(e) => setTF({ system_name: e.target.value })} />
                </div>
                <div>
                  <label className="block eyebrow mb-1">구분</label>
                  <input className="form-input w-full px-2 py-1.5 text-sm" placeholder="서버/네트워크/저장장치" value={targetForm.category} onChange={(e) => setTF({ category: e.target.value })} />
                </div>
                <div>
                  <label className="block eyebrow mb-1">유형</label>
                  <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.asset_type_label} onChange={(e) => setTF({ asset_type_label: e.target.value })} />
                </div>
                <div>
                  <label className="block eyebrow mb-1">정보자원명</label>
                  <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.resource_name} onChange={(e) => setTF({ resource_name: e.target.value })} />
                </div>
                <div>
                  <label className="block eyebrow mb-1">수량</label>
                  <input type="number" min={1} className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.quantity} onChange={(e) => setTF({ quantity: e.target.value })} />
                </div>
                <div>
                  <label className="block eyebrow mb-1">제조사</label>
                  <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.manufacturer} onChange={(e) => setTF({ manufacturer: e.target.value })} />
                </div>
                <div>
                  <label className="block eyebrow mb-1">호스트명</label>
                  <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.host_name} onChange={(e) => setTF({ host_name: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="block eyebrow mb-1">용도</label>
                  <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.purpose} onChange={(e) => setTF({ purpose: e.target.value })} />
                </div>
                <div>
                  <label className="block eyebrow mb-1">위치</label>
                  <input className="form-input w-full px-2 py-1.5 text-sm" placeholder="지역/건물/층" value={targetForm.location_text} onChange={(e) => setTF({ location_text: e.target.value })} />
                </div>
                <div>
                  <label className="block eyebrow mb-1">랙위치</label>
                  <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.rack_position} onChange={(e) => setTF({ rack_position: e.target.value })} />
                </div>
                <div>
                  <label className="block eyebrow mb-1">자산코드</label>
                  <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.asset_code} onChange={(e) => setTF({ asset_code: e.target.value })} />
                </div>
                <div>
                  <label className="block eyebrow mb-1">자산사용부서</label>
                  <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.owner_department} onChange={(e) => setTF({ owner_department: e.target.value })} />
                </div>
                <div>
                  <label className="block eyebrow mb-1">자산사용자</label>
                  <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.owner_user} onChange={(e) => setTF({ owner_user: e.target.value })} />
                </div>
                <div>
                  <label className="block eyebrow mb-1">취득일자</label>
                  <input type="date" className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.acquisition_date} onChange={(e) => setTF({ acquisition_date: e.target.value })} />
                </div>
                <div>
                  <label className="block eyebrow mb-1">도입금액</label>
                  <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.acquisition_amount} onChange={(e) => setTF({ acquisition_amount: e.target.value })} />
                </div>
              </div>

              <div className="border-t border-line pt-3">
                <div className="eyebrow mb-2">유지관리 기간 · 산정</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block eyebrow mb-1">유지보수 시작</label>
                    <input type="date" className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.maintenance_start} onChange={(e) => setTF({ maintenance_start: e.target.value })} />
                  </div>
                  <div>
                    <label className="block eyebrow mb-1">유지보수 종료</label>
                    <input type="date" className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.maintenance_end} onChange={(e) => setTF({ maintenance_end: e.target.value })} />
                  </div>
                  <div>
                    <label className="block eyebrow mb-1">기간(개월)</label>
                    <input type="number" min={0} className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.maintenance_months} onChange={(e) => setTF({ maintenance_months: e.target.value })} />
                  </div>
                  <div>
                    <label className="block eyebrow mb-1">업무영향범위</label>
                    <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.business_impact} onChange={(e) => setTF({ business_impact: e.target.value })} />
                  </div>
                  <div>
                    <label className="block eyebrow mb-1">데이터중요도</label>
                    <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.data_importance} onChange={(e) => setTF({ data_importance: e.target.value })} />
                  </div>
                  <div>
                    <label className="block eyebrow mb-1">이용자수/처리건수</label>
                    <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.user_traffic} onChange={(e) => setTF({ user_traffic: e.target.value })} />
                  </div>
                  <div>
                    <label className="block eyebrow mb-1">H/W</label>
                    <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.hardware_score} onChange={(e) => setTF({ hardware_score: e.target.value })} />
                  </div>
                  <div>
                    <label className="block eyebrow mb-1">유지보수난이도</label>
                    <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.maintenance_difficulty} onChange={(e) => setTF({ maintenance_difficulty: e.target.value })} />
                  </div>
                  <div>
                    <label className="block eyebrow mb-1">유지보수항목</label>
                    <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.maintenance_scope} onChange={(e) => setTF({ maintenance_scope: e.target.value })} />
                  </div>
                  <div>
                    <label className="block eyebrow mb-1">측정점수</label>
                    <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.score_total} onChange={(e) => setTF({ score_total: e.target.value })} />
                  </div>
                  <div>
                    <label className="block eyebrow mb-1">유지관리등급</label>
                    <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.grade} onChange={(e) => setTF({ grade: e.target.value })} />
                  </div>
                  <div>
                    <label className="block eyebrow mb-1">유지관리요율</label>
                    <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.rate} onChange={(e) => setTF({ rate: e.target.value })} />
                  </div>
                  <div>
                    <label className="block eyebrow mb-1">추정금액(계산)</label>
                    <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.estimated_amount_calc} onChange={(e) => setTF({ estimated_amount_calc: e.target.value })} />
                  </div>
                  <div>
                    <label className="block eyebrow mb-1">추정금액(입력)</label>
                    <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.estimated_amount_input} onChange={(e) => setTF({ estimated_amount_input: e.target.value })} />
                  </div>
                  <div className="col-span-2">
                    <label className="block eyebrow mb-1">근거자료</label>
                    <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.evidence_note} onChange={(e) => setTF({ evidence_note: e.target.value })} />
                  </div>
                </div>
              </div>

              <div>
                <label className="block eyebrow mb-1">비고</label>
                <input className="form-input w-full px-2 py-1.5 text-sm" value={targetForm.notes} onChange={(e) => setTF({ notes: e.target.value })} />
              </div>

              <div className="flex justify-end gap-2">
                <button className="px-4 py-2 text-sm text-ink-2 hover:text-ink" onClick={closeTargetForm}>취소</button>
                <button className="btn-ink px-4 py-2 text-sm" onClick={handleTargetSubmit}>{editingTargetId ? "수정" : "등록"}</button>
              </div>
            </div>
          )}

          {/* 대상 테이블 */}
          <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-panel border-b border-line">
                <tr>
                  <th className="text-left px-3 py-2 eyebrow">정보자원명</th>
                  <th className="text-left px-3 py-2 eyebrow">시스템</th>
                  <th className="text-left px-3 py-2 eyebrow">자산코드</th>
                  <th className="px-3 py-2 eyebrow cursor-pointer select-none group" onClick={() => toggleTargetSort("owner_department")} title="부서 정렬">
                    <span className="inline-flex items-center gap-1 group-hover:text-ink">부서 <SortIcon sortKey="owner_department" /></span>
                  </th>
                  <th className="text-left px-3 py-2 eyebrow">유지기간</th>
                  <th className="px-3 py-2 eyebrow cursor-pointer select-none group" onClick={() => toggleTargetSort("grade")} title="등급 정렬">
                    <span className="inline-flex items-center gap-1 group-hover:text-ink">등급 <SortIcon sortKey="grade" /></span>
                  </th>
                  <th className="px-3 py-2 eyebrow cursor-pointer select-none group text-right" onClick={() => toggleTargetSort("amount")} title="추정금액 정렬">
                    <span className="inline-flex items-center gap-1 justify-end group-hover:text-ink">추정금액 <SortIcon sortKey="amount" /></span>
                  </th>
                  <th className="text-left px-3 py-2 eyebrow">관리</th>
                </tr>
              </thead>
              <tbody>
                {sortedTargets.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-8 text-ink-3">등록된 유지관리 대상이 없습니다.</td></tr>
                )}
                {sortedTargets.map((t) => (
                  <tr key={t.id} className="border-b border-line hover:bg-slate-100">
                    <td className="px-3 py-2 font-medium">{t.resource_name || t.asset_name || "-"}</td>
                    <td className="px-3 py-2">{t.system_name || "-"}</td>
                    <td className="px-3 py-2 num text-ink-3">{t.asset_code || "-"}</td>
                    <td className="px-3 py-2 text-ink-3">{t.owner_department || "-"}</td>
                    <td className="px-3 py-2 num text-ink-3 whitespace-nowrap">{t.maintenance_start || "-"} ~ {t.maintenance_end || "-"}</td>
                    <td className="px-3 py-2">{t.grade || "-"}</td>
                    <td className="px-3 py-2 num text-right">{formatAmount(t.estimated_amount_input || t.estimated_amount_calc)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button className="px-2 py-1 text-ink-2 rounded text-xs hover:bg-slate-100" onClick={() => openTargetEdit(t)} title="수정">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button className="px-2 py-1 text-fault rounded text-xs hover:bg-red-50" onClick={() => handleTargetDelete(t.id)} title="삭제">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

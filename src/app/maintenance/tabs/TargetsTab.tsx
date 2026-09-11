"use client";

// 유지관리 대상/금액 목록 · 등록/수정 · 임포트/익스포트 · 정렬 · 삭제 탭
import { useMemo, useState } from "react";
import { ChevronDown, ChevronsUpDown, ChevronUp, Download, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { TargetForm } from "./TargetForm";
import { emptyTarget, formatAmount, targetToForm } from "./types";
import type { AssetOption, Target, TargetForm as TargetFormValues } from "./types";

type SortKey = "owner_department" | "grade" | "amount";

interface Props {
  targets: Target[];
  onTargetsChange: (targets: Target[]) => void;
  assets: AssetOption[];
}

export function TargetsTab({ targets, onTargetsChange, assets }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TargetFormValues>(emptyTarget);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((t) =>
      `${t.asset_name || ""} ${t.system_name} ${t.resource_name} ${t.asset_code} ${t.manufacturer} ${t.owner_department}`
        .toLowerCase()
        .includes(q)
    );
  }, [targets, search]);

  const amountOf = (t: Target) => {
    const n = Number(String(t.estimated_amount_input || t.estimated_amount_calc || "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const { key, dir } = sort;
    const sign = dir === "asc" ? 1 : -1;
    const arr = [...filtered];
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
  }, [filtered, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev && prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  }

  function SortIcon({ sortKey }: { sortKey: SortKey }) {
    if (!sort || sort.key !== sortKey) {
      return <ChevronsUpDown className="h-3.5 w-3.5 text-ink-3/50 group-hover:text-ink-3" />;
    }
    return sort.dir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-signal" />
      : <ChevronDown className="h-3.5 w-3.5 text-signal" />;
  }

  const totals = useMemo(() => {
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

  function openCreate() {
    setEditingId(null);
    setForm(emptyTarget);
    setShowForm(true);
  }

  function openEdit(t: Target) {
    setEditingId(t.id);
    setForm(targetToForm(t));
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyTarget);
  }

  async function handleSubmit() {
    if (!form.resource_name.trim() && !form.asset_id) {
      return alert("정보자원명을 입력하거나 자산을 선택하세요.");
    }
    const payload = {
      ...form,
      record_kind: "target",
      asset_id: form.asset_id ? Number(form.asset_id) : null,
      quantity: Number(form.quantity) || 1,
      maintenance_months: Number(form.maintenance_months) || 0,
    };
    const url = editingId ? `/api/maintenance/${editingId}` : "/api/maintenance";
    const method = editingId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const saved: Target = await res.json();
      if (editingId) {
        onTargetsChange(targets.map((t) => (t.id === saved.id ? saved : t)));
      } else {
        onTargetsChange([saved, ...targets]);
      }
      closeForm();
    } else {
      // 서버 검증 메시지(400: 어떤 필드가 왜 거부됐는지)를 그대로 보여준다 (비평 반영)
      const data = await res.json().catch(() => ({}));
      alert(data.error || "저장에 실패했습니다.");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("이 유지관리 대상 기록을 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/maintenance/${id}?record_kind=target`, { method: "DELETE" });
    if (res.ok) onTargetsChange(targets.filter((t) => t.id !== id));
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
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
      {/* 통계 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="panel p-3 text-center">
          <div className="num text-2xl font-bold text-ink">{totals.total}</div>
          <div className="eyebrow">유지관리 대상</div>
        </div>
        <div className="panel p-3 text-center">
          <div className="num text-2xl font-bold text-warn">{totals.expiringSoon}</div>
          <div className="eyebrow">60일 내 종료</div>
        </div>
        <div className="panel p-3 text-center">
          <div className="num text-2xl font-bold text-signal">{formatAmount(String(totals.sum))}</div>
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
            onChange={handleImport}
          />
        </label>
        <button className="btn-ink flex items-center gap-1 px-4 py-2 text-sm" onClick={openCreate}>
          <Plus className="h-4 w-4" /> 대상 등록
        </button>
      </div>

      {/* 등록/수정 폼 */}
      {showForm && (
        <TargetForm form={form} editing={editingId !== null} onPatch={(patch) => setForm((f) => ({ ...f, ...patch }))} assets={assets} onSubmit={handleSubmit} onCancel={closeForm} />
      )}

      {/* 대상 테이블 */}
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-panel border-b border-line">
            <tr>
              <th className="text-left px-3 py-2 eyebrow">정보자원명</th>
              <th className="text-left px-3 py-2 eyebrow">시스템</th>
              <th className="text-left px-3 py-2 eyebrow">자산코드</th>
              <th className="px-3 py-2 eyebrow cursor-pointer select-none group" onClick={() => toggleSort("owner_department")} title="부서 정렬">
                <span className="inline-flex items-center gap-1 group-hover:text-ink">부서 <SortIcon sortKey="owner_department" /></span>
              </th>
              <th className="text-left px-3 py-2 eyebrow">유지기간</th>
              <th className="px-3 py-2 eyebrow cursor-pointer select-none group" onClick={() => toggleSort("grade")} title="등급 정렬">
                <span className="inline-flex items-center gap-1 group-hover:text-ink">등급 <SortIcon sortKey="grade" /></span>
              </th>
              <th className="px-3 py-2 eyebrow cursor-pointer select-none group text-right" onClick={() => toggleSort("amount")} title="추정금액 정렬">
                <span className="inline-flex items-center gap-1 justify-end group-hover:text-ink">추정금액 <SortIcon sortKey="amount" /></span>
              </th>
              <th className="text-left px-3 py-2 eyebrow">관리</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-ink-3">등록된 유지관리 대상이 없습니다.</td></tr>
            )}
            {sorted.map((t) => (
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
                    <button className="px-2 py-1 text-ink-2 rounded text-xs hover:bg-slate-100" onClick={() => openEdit(t)} title="수정">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button className="px-2 py-1 text-fault rounded text-xs hover:bg-red-50" onClick={() => handleDelete(t.id)} title="삭제">
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
  );
}

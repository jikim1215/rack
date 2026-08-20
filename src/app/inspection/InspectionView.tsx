"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ClipboardCheck,
  CheckCircle2,
  HelpCircle,
  AlertTriangle,
  Plus,
  Lock,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { UsageGuide } from "@/components/UsageGuide";

interface Audit {
  id: number;
  audit_name: string;
  status: "open" | "closed";
  started_at: string;
  closed_at: string;
  created_by: string;
  description: string;
  total_assets: number;
  checked_assets: number;
  closed_total?: number | null;
  closed_checked?: number | null;
  closed_mismatch?: number | null;
  closed_equip_checked?: number | null;
  closed_sub_checked?: number | null;
}

// 장비(assets) + 부속자산(sub_assets) 공용 행 — GET [id]/checks UNION 결과와 동일 모양.
//  - 장비: type_or_category = 유형 라벨, location = 랙명, code = 관리번호(asset_tag)
//  - 부속: type_or_category = 중분류 > 소분류, location = 설치장소, code = 자산코드
interface CheckRow {
  kind: "asset" | "sub";
  target_id: number;
  asset_type: string | null;
  name: string;
  type_or_category: string;
  location: string | null;
  serial_number: string;
  code: string;
  check_id: number | null;
  result: string | null;
  note: string | null;
  checked_by: string | null;
  checked_at: string | null;
}

const typeLabels: Record<string, string> = {
  server: "서버", network: "네트워크", security: "정보보호", telecom: "전화설비", vm: "가상머신", other: "기타",
};

const resultLabels: Record<string, string> = {
  confirmed: "확인",
  missing: "분실",
  moved: "이동",
  disposed: "폐기",
};

const resultColors: Record<string, string> = {
  confirmed: "bg-signal/10 text-signal",
  missing: "bg-fault/10 text-fault",
  moved: "bg-warn/10 text-warn",
  disposed: "bg-slate-100 text-ink-2",
};

// 확인상태 정렬 순위 — 미확인 → 확인 → 분실 → 이동 → 폐기
const resultRank: Record<string, number> = {
  confirmed: 1, missing: 2, moved: 3, disposed: 4,
};

const PAGE_SIZE = 50;

type SortKey = "name" | "type" | "status" | "checked_at";

function rowKey(r: Pick<CheckRow, "kind" | "target_id">) {
  return `${r.kind}:${r.target_id}`;
}

interface SerialMismatch { asset_tag: string; ledger_name: string; ledger_serial: string; db_asset: string; db_serial: string }

export default function InspectionView({
  initialAudits,
  initialAuditId,
  initialRows,
  role,
  serialMismatches = [],
}: {
  initialAudits: Audit[];
  initialAuditId: number | null;
  initialRows: CheckRow[];
  role: string;
  serialMismatches?: SerialMismatch[];
}) {
  const [showMismatches, setShowMismatches] = useState(false);
  const { addToast } = useToast();
  const [audits, setAudits] = useState<Audit[]>(initialAudits);
  const [selectedId, setSelectedId] = useState<number | null>(initialAuditId);
  const [rows, setRows] = useState<CheckRow[]>(initialRows);
  const [loading, setLoading] = useState(false);

  // 필터
  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState<"all" | "asset" | "sub">("all");
  const [filterType, setFilterType] = useState("all");
  const [uncheckedOnly, setUncheckedOnly] = useState(false);

  // 정렬 — 기본(null)은 미확인 우선 + 이름순. 헤더 클릭으로 키 지정/방향 토글.
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // 클라이언트 페이지네이션 (장비+부속 500+ 행 대비, 50건/페이지)
  const [page, setPage] = useState(1);

  // 회차 생성 폼 (admin)
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // 행별 비고 초안 — 저장 전 입력 값 (키: `${kind}:${target_id}`)
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const isAdmin = role === "admin";
  const canCheck = role === "admin" || role === "team";
  const selected = audits.find((a) => a.id === selectedId) ?? null;
  const readOnly = !canCheck || !selected || selected.status === "closed";

  // KPI — 부속 포함 합계 + 장비/부속 분해 보조표기
  const kpi = useMemo(() => {
    const split = (list: CheckRow[]) => {
      const a = list.filter((r) => r.kind === "asset").length;
      return { n: list.length, a, s: list.length - a };
    };
    return {
      total: split(rows),
      confirmed: split(rows.filter((r) => r.result === "confirmed")),
      unchecked: split(rows.filter((r) => r.check_id == null)),
      missing: split(rows.filter((r) => r.result === "missing")),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterKind !== "all" && r.kind !== filterKind) return false;
      if (filterType !== "all" && (r.kind !== "asset" || r.asset_type !== filterType)) return false;
      if (uncheckedOnly && r.check_id != null) return false;
      if (q) {
        const hay = `${r.name} ${r.location || ""} ${r.serial_number} ${r.code}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, filterKind, filterType, uncheckedOnly]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const byName = (a: CheckRow, b: CheckRow) => a.name.localeCompare(b.name, "ko");
    if (!sortKey) {
      // 기본: 미확인 우선 + 이름순
      arr.sort((a, b) => {
        const ua = a.check_id == null ? 0 : 1;
        const ub = b.check_id == null ? 0 : 1;
        if (ua !== ub) return ua - ub;
        return byName(a, b);
      });
      return arr;
    }
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = byName(a, b);
      else if (sortKey === "type") cmp = a.type_or_category.localeCompare(b.type_or_category, "ko");
      else if (sortKey === "status") cmp = (resultRank[a.result ?? ""] ?? 0) - (resultRank[b.result ?? ""] ?? 0);
      else cmp = (a.checked_at ?? "").localeCompare(b.checked_at ?? "");
      if (cmp === 0) cmp = byName(a, b);
      return cmp * dir;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  // 필터/정렬이 바뀌면 1페이지로 복귀
  useEffect(() => {
    setPage(1);
  }, [search, filterKind, filterType, uncheckedOnly, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sorted, safePage]
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortMark(key: SortKey) {
    if (sortKey !== key) return null;
    return <span className="ml-0.5 text-[10px]">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }

  async function refreshAudits(): Promise<Audit[]> {
    const res = await fetch("/api/inventory-audits");
    if (!res.ok) return audits;
    const list: Audit[] = await res.json();
    setAudits(list);
    return list;
  }

  async function selectAudit(id: number) {
    setSelectedId(id);
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory-audits/${id}/checks`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRows(data.rows);
      setNoteDrafts({});
      setPage(1);
    } catch {
      addToast("확인 현황을 불러오지 못했습니다.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/inventory-audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audit_name: newName.trim(), description: newDesc }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error);
      }
      const created = await res.json();
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
      await refreshAudits();
      await selectAudit(created.id);
      addToast(`자산실사 '${created.audit_name}' 회차가 생성되었습니다.`, "success");
    } catch (err) {
      addToast(err instanceof Error && err.message ? err.message : "회차 생성에 실패했습니다.", "error");
    } finally {
      setCreating(false);
    }
  }

  async function handleClose() {
    if (!selected) return;
    if (!confirm(`'${selected.audit_name}' 회차를 마감하시겠습니까?\n\n자동 처리: 마감 시점의 대상/확인 집계가 스냅샷으로 고정됩니다.\n마감 후에는 기록·삭제가 불가합니다(감사 증적 보존).`)) return;
    const res = await fetch(`/api/inventory-audits/${selected.id}`, { method: "PUT" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addToast(err.error || "마감에 실패했습니다.", "error");
      return;
    }
    await refreshAudits();
    addToast(`'${selected.audit_name}' 회차가 마감되었습니다.`, "success");
  }

  async function handleDelete() {
    if (!selected) return;
    if (!confirm(`'${selected.audit_name}' 회차와 확인 기록을 모두 삭제하시겠습니까?\n\n진행중(open) 회차만 삭제할 수 있으며, 삭제는 되돌릴 수 없습니다.`)) return;
    const res = await fetch(`/api/inventory-audits/${selected.id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addToast(err.error || "삭제에 실패했습니다.", "error");
      return;
    }
    const list = await refreshAudits();
    const next = list.find((a) => a.id !== selected.id) ?? null;
    if (next) await selectAudit(next.id);
    else {
      setSelectedId(null);
      setRows([]);
    }
    addToast("회차가 삭제되었습니다.", "success");
  }

  async function recordCheck(row: CheckRow, result: string) {
    if (!selected || readOnly) return;
    const note = noteDrafts[rowKey(row)] ?? row.note ?? "";
    const res = await fetch(`/api/inventory-audits/${selected.id}/checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: row.kind, target_id: row.target_id, result, note }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addToast(err.error || "기록에 실패했습니다.", "error");
      return;
    }
    const check = await res.json();
    setRows((prev) =>
      prev.map((r) =>
        r.kind === row.kind && r.target_id === row.target_id
          ? { ...r, check_id: check.id, result: check.result, note: check.note, checked_by: check.checked_by, checked_at: check.checked_at }
          : r
      )
    );
    setAudits((prev) =>
      prev.map((a) =>
        a.id === selected.id && row.check_id == null
          ? { ...a, checked_assets: a.checked_assets + 1 }
          : a
      )
    );
    addToast(`'${row.name}' — ${resultLabels[result] || result} 처리되었습니다.`, "success");
  }

  const progress = selected && selected.total_assets > 0
    ? Math.round((selected.checked_assets / selected.total_assets) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* 회차 셀렉터 + 관리 버튼 */}
      <div className="panel p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">조사 회차</label>
            <select
              className="form-input"
              value={selectedId ?? ""}
              onChange={(e) => e.target.value && selectAudit(Number(e.target.value))}
            >
              {audits.length === 0 && <option value="">회차 없음</option>}
              {audits.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.audit_name} {a.status === "closed" ? "(마감)" : ""} — {a.checked_assets}/{a.total_assets}
                </option>
              ))}
            </select>
          </div>
          {selected && (
            <div className="flex items-center gap-2 pb-2 text-sm text-ink-2">
              <span className="num">{progress}%</span>
              {selected.status === "closed" ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-slate-100 text-ink-2">
                  <Lock size={12} /> 마감 {selected.closed_at}
                  {selected.closed_total != null && (
                    <span className="num ml-1" title="마감 시점 고정 스냅샷 (감사 증빙용)">
                      — 대상 {selected.closed_total} · 확인 {selected.closed_checked}
                      (장비 {selected.closed_equip_checked ?? "?"}·부속 {selected.closed_sub_checked ?? "?"}) · 불일치 {selected.closed_mismatch ?? 0}
                    </span>
                  )}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-signal/10 text-signal">
                  진행중
                </span>
              )}
            </div>
          )}
          <div className="flex-1" />
          {isAdmin && (
            <div className="flex items-center gap-2">
              {selected && selected.status === "open" && (
                <button className="btn-ink" onClick={handleClose}>
                  <Lock size={15} className="mr-1.5" /> 회차 마감
                </button>
              )}
              {selected && (
                <button
                  className="p-2 text-ink-3 hover:text-fault transition-colors"
                  title="회차 삭제"
                  onClick={handleDelete}
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button className="btn-ink" onClick={() => setShowCreate((v) => !v)}>
                <Plus size={15} className="mr-1.5" /> 새 회차
              </button>
            </div>
          )}
        </div>

        {/* 회차 생성 폼 (admin) */}
        {isAdmin && showCreate && (
          <form onSubmit={handleCreate} className="mt-4 pt-4 border-t border-line flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">회차 이름</label>
              <input
                className="form-input"
                placeholder="예: 2026년 정기 자산실사"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </div>
            <div className="flex-1 min-w-48">
              <label className="block text-sm font-medium text-gray-700 mb-1">설명 (선택)</label>
              <input
                className="form-input w-full"
                placeholder="비고"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-ink" disabled={creating}>
              {creating ? "생성 중…" : "생성"}
            </button>
          </form>
        )}
      </div>

      {/* KPI — 장비 + 부속 합계, 보조표기로 분해 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="panel p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-slate-100 text-ink flex items-center justify-center">
            <ClipboardCheck className="w-5 h-5" />
          </div>
          <div>
            <p className="eyebrow">대상</p>
            <p className="text-2xl font-bold num">{kpi.total.n}건</p>
            <p className="text-xs text-ink-3">장비 {kpi.total.a}·부속 {kpi.total.s}</p>
          </div>
        </div>
        <div className="panel p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-signal/10 text-signal flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <p className="eyebrow">확인</p>
            <p className="text-2xl font-bold num">{kpi.confirmed.n}건</p>
            <p className="text-xs text-ink-3">장비 {kpi.confirmed.a}·부속 {kpi.confirmed.s}</p>
          </div>
        </div>
        <div className="panel p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-slate-100 text-ink-2 flex items-center justify-center">
            <HelpCircle className="w-5 h-5" />
          </div>
          <div>
            <p className="eyebrow">미확인</p>
            <p className="text-2xl font-bold num">{kpi.unchecked.n}건</p>
            <p className="text-xs text-ink-3">장비 {kpi.unchecked.a}·부속 {kpi.unchecked.s}</p>
          </div>
        </div>
        <div className="panel p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-fault/10 text-fault flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <p className="eyebrow">분실</p>
            <p className="text-2xl font-bold num">{kpi.missing.n}건</p>
            <p className="text-xs text-ink-3">장비 {kpi.missing.a}·부속 {kpi.missing.s}</p>
          </div>
        </div>
      </div>

      {/* 시리얼 불일치 참조 목록 (외부 검토 R3-3 합의): AX 대장 대사에서 나온 특이 건 — 실사 시 우선 확인 대상 */}
      {serialMismatches.length > 0 && (
        <div className="panel p-4 mb-5">
          <button onClick={() => setShowMismatches(!showMismatches)} className="flex items-center gap-2 text-sm w-full text-left">
            <AlertTriangle className="w-4 h-4 text-warn" />
            <span className="font-semibold">시리얼 불일치 참조 목록</span>
            <span className="num text-warn font-bold">{serialMismatches.length}건</span>
            <span className="text-xs text-ink-3">— 관리대장과 시스템의 시리얼이 다른 장비. 실사 시 실물 시리얼을 우선 확인하세요</span>
            <span className="ml-auto text-ink-3 text-xs">{showMismatches ? "접기 ▲" : "펼치기 ▼"}</span>
          </button>
          {showMismatches && (
            <div className="mt-3 max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-ink-3 border-b border-line">
                    <th className="py-1.5 pr-3">관리번호</th>
                    <th className="py-1.5 pr-3">대장 자산명</th>
                    <th className="py-1.5 pr-3">대장 시리얼</th>
                    <th className="py-1.5 pr-3">시스템 자산명</th>
                    <th className="py-1.5">시스템 시리얼</th>
                  </tr>
                </thead>
                <tbody>
                  {serialMismatches.map((m, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      <td className="py-1.5 pr-3 num text-ink-3">{m.asset_tag || "-"}</td>
                      <td className="py-1.5 pr-3">{m.ledger_name}</td>
                      <td className="py-1.5 pr-3 num text-fault">{m.ledger_serial || "-"}</td>
                      <td className="py-1.5 pr-3">
                        <a href={`/assets?q=${encodeURIComponent(m.db_asset)}`} className="hover:underline">{m.db_asset}</a>
                      </td>
                      <td className="py-1.5 num text-signal">{m.db_serial || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-ink-3 mt-2">실물 확인 후 맞는 값을 자산관리에서 수정하면 됩니다. 이 목록은 관리대장 대사 산출물(읽기 전용)입니다.</p>
            </div>
          )}
        </div>
      )}

      {/* 대상 테이블 */}
      <div className="panel p-5">
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">구분</label>
            <select
              className="form-input"
              value={filterKind}
              onChange={(e) => setFilterKind(e.target.value as "all" | "asset" | "sub")}
            >
              <option value="all">전체</option>
              <option value="asset">장비</option>
              <option value="sub">부속</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">유형 (장비)</label>
            <select className="form-input" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">전체</option>
              {Object.entries(typeLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-56">
            <label className="block text-sm font-medium text-gray-700 mb-1">검색</label>
            <input
              className="form-input w-full"
              placeholder="이름, 랙/장소, 시리얼, 관리번호/자산코드"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-ink-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={uncheckedOnly}
              onChange={(e) => setUncheckedOnly(e.target.checked)}
            />
            미확인만 보기
          </label>
          {/* 페이지 인덱스 — 필터바 우측(화면 중간 높이): 페이지 전환하러 바닥까지 스크롤하지 않도록 */}
          {!loading && selected && sorted.length > 0 && (
            <div className="ml-auto flex items-center gap-1 pb-1 text-sm text-ink-2 whitespace-nowrap">
              <span className="num text-xs text-ink-3 mr-1">
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, sorted.length)} / {sorted.length}건
              </span>
              <button
                className="p-1.5 rounded text-ink-3 hover:text-ink disabled:opacity-30 disabled:pointer-events-none transition-colors"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
                title="이전 페이지"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="px-1 num">{safePage} / {totalPages}</span>
              <button
                className="p-1.5 rounded text-ink-3 hover:text-ink disabled:opacity-30 disabled:pointer-events-none transition-colors"
                disabled={safePage >= totalPages}
                onClick={() => setPage(safePage + 1)}
                title="다음 페이지"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>

        {/* 사용 가이드 (접기/펼치기) */}
        <UsageGuide
          className="mb-4 text-right"
          items={[
            <>실사는 <strong className="text-ink-2">회차 단위</strong>로 진행됩니다 — 총괄이 회차를 열면 각 팀이 자기 팀 자산을 확인합니다</>,
            <>대상은 <strong className="text-ink-2">장비+부속자산 전체</strong>이며, 구분 필터로 나눠 볼 수 있습니다</>,
            ...(canCheck
              ? [<>실물 대조 후 <strong className="text-ink-2">확인/분실/이동/폐기</strong> 중 하나를 누르면 즉시 기록됩니다(재클릭으로 정정 가능)</>]
              : []),
            <>컬럼 제목을 누르면 정렬, <strong className="text-ink-2">미확인만 보기</strong>로 남은 대상만 모아 볼 수 있습니다</>,
            <>회차를 마감하면 읽기 전용이 됩니다 — 증빙으로 보존됩니다</>,
          ]}
        />

        {loading ? (
          <p className="text-sm text-ink-3 py-8 text-center">불러오는 중…</p>
        ) : !selected ? (
          <p className="text-sm text-ink-3 py-8 text-center">
            조사 회차가 없습니다.{isAdmin ? " '새 회차'로 자산실사를 시작하세요." : ""}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink-3 border-b border-line">
                    <th className="py-2 pr-3 font-medium">구분</th>
                    <th
                      className="py-2 pr-3 font-medium cursor-pointer select-none hover:text-ink"
                      onClick={() => toggleSort("name")}
                    >
                      이름{sortMark("name")}
                    </th>
                    <th
                      className="py-2 pr-3 font-medium cursor-pointer select-none hover:text-ink"
                      onClick={() => toggleSort("type")}
                    >
                      유형/분류{sortMark("type")}
                    </th>
                    <th className="py-2 pr-3 font-medium">랙/장소</th>
                    <th className="py-2 pr-3 font-medium">시리얼</th>
                    <th
                      className="py-2 pr-3 font-medium cursor-pointer select-none hover:text-ink"
                      onClick={() => toggleSort("status")}
                    >
                      확인상태{sortMark("status")}
                    </th>
                    <th
                      className="py-2 pr-3 font-medium cursor-pointer select-none hover:text-ink"
                      onClick={() => toggleSort("checked_at")}
                    >
                      확인자/일시{sortMark("checked_at")}
                    </th>
                    {!readOnly && <th className="py-2 pr-3 font-medium">확인 처리</th>}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={rowKey(row)} className="border-b border-line/60 hover:bg-slate-50/50">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            row.kind === "asset" ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-ink-2"
                          }`}
                        >
                          {row.kind === "asset" ? "장비" : "부속"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-medium">{row.name}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{row.type_or_category || "—"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{row.location || "—"}</td>
                      <td className="py-2 pr-3 num">{row.serial_number || "—"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {row.result ? (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${resultColors[row.result] || "bg-slate-100 text-ink-2"}`}>
                            {resultLabels[row.result] || row.result}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-ink-3">미확인</span>
                        )}
                        {row.note ? <span className="ml-2 text-xs text-ink-3">{row.note}</span> : null}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-xs text-ink-3">
                        {row.checked_by ? `${row.checked_by} · ${row.checked_at}` : "—"}
                      </td>
                      {!readOnly && (
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-1.5">
                            {Object.entries(resultLabels).map(([k, v]) => (
                              <button
                                key={k}
                                onClick={() => {
                                  recordCheck(row, k);
                                  // 확인 외 판정(분실/이동 등)은 근거 메모 유도 — 메모가 비어 있으면 자동 포커스 (외부 검토 P1-2 합의)
                                  if (k !== "confirmed" && !((noteDrafts[rowKey(row)] ?? row.note) || "").trim()) {
                                    requestAnimationFrame(() => {
                                      const el = document.querySelector<HTMLInputElement>(`input[data-note-for="${rowKey(row)}"]`);
                                      el?.focus();
                                      el?.classList.add("ring-2", "ring-warn");
                                      setTimeout(() => el?.classList.remove("ring-2", "ring-warn"), 2000);
                                    });
                                  }
                                }}
                                className={`px-2 py-1 rounded text-xs border transition-colors ${
                                  row.result === k
                                    ? `${resultColors[k]} border-transparent font-medium`
                                    : "border-line text-ink-2 hover:bg-slate-50"
                                }`}
                              >
                                {v}
                              </button>
                            ))}
                            <input
                              data-note-for={rowKey(row)}
                              className="form-input !py-1 !text-xs w-32"
                              placeholder="비고 (분실·이동 시 근거 기재)"
                              value={noteDrafts[rowKey(row)] ?? row.note ?? ""}
                              onChange={(e) =>
                                setNoteDrafts((prev) => ({ ...prev, [rowKey(row)]: e.target.value }))
                              }
                            />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={readOnly ? 7 : 8} className="py-8 text-center text-ink-3">
                        조건에 맞는 대상이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 페이지네이션 */}
            {sorted.length > 0 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-line text-sm text-ink-2">
                <span className="num">
                  {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, sorted.length)} / {sorted.length}건
                </span>
                <div className="flex items-center gap-1">
                  <button
                    className="p-1.5 rounded text-ink-3 hover:text-ink disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    disabled={safePage <= 1}
                    onClick={() => setPage(safePage - 1)}
                    title="이전 페이지"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="px-2 num">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    className="p-1.5 rounded text-ink-3 hover:text-ink disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage(safePage + 1)}
                    title="다음 페이지"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

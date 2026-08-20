"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Plus,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  PackageX,
  RotateCcw,
  X,
  Download,
  Upload,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { UsageGuide } from "@/components/UsageGuide";

interface SubAsset {
  id: number;
  asset_code: string;
  category_major: string;
  category_mid: string;
  category_minor: string;
  sub_name: string;
  spec: string;
  serial_number: string;
  acquired_date: string;
  user_name: string;
  place: string;
  purpose: string;
  note: string;
  status: "active" | "disposed";
  parent_asset_id: number | null;
  team_id: number | null;
  created_at: string;
  updated_at: string;
  parent_name: string | null;
}

interface CategoryAgg {
  category_mid: string;
  category_minor: string;
  cnt: number;
}

interface ParentAsset {
  id: number;
  asset_name: string;
  asset_type: string;
  ip_address: string;
  serial_number: string;
}

const PAGE_SIZE = 50;

const emptyForm = {
  asset_code: "",
  category_major: "",
  category_mid: "",
  category_minor: "",
  sub_name: "",
  spec: "",
  serial_number: "",
  acquired_date: "",
  user_name: "",
  place: "",
  purpose: "",
  note: "",
};

type FormState = typeof emptyForm;

export default function SubAssetsView({
  initialRows,
  categories,
  canWrite,
}: {
  initialRows: SubAsset[];
  categories: CategoryAgg[];
  canWrite: boolean;
}) {
  const { addToast } = useToast();
  const [rows, setRows] = useState<SubAsset[]>(initialRows);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 필터 — 중분류 → 소분류 연동 + 통합검색 + 폐기 포함 토글
  const [filterMid, setFilterMid] = useState("");
  const [filterMinor, setFilterMinor] = useState("");
  const [search, setSearch] = useState("");
  const [includeDisposed, setIncludeDisposed] = useState(false);

  // 클라이언트 페이지네이션 (400+ 행 대비, 50건/페이지)
  const [page, setPage] = useState(1);

  // 등록/수정 인라인 패널
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SubAsset | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  // 부모장비 연결 — 텍스트 검색 → /api/assets 결과 이름 필터 셀렉트
  const [parentId, setParentId] = useState<number | null>(null);
  const [parentName, setParentName] = useState<string>("");
  const [parentQuery, setParentQuery] = useState("");
  const [parentOptions, setParentOptions] = useState<ParentAsset[]>([]);
  const [parentLoaded, setParentLoaded] = useState(false);

  // 분류 옵션 — SSR 집계 + 클라이언트에서 새로 생긴 분류 병합
  const mids = useMemo(() => {
    const set = new Set<string>();
    for (const c of categories) if (c.category_mid) set.add(c.category_mid);
    for (const r of rows) if (r.category_mid) set.add(r.category_mid);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [categories, rows]);

  const minors = useMemo(() => {
    const set = new Set<string>();
    for (const c of categories) {
      if (filterMid && c.category_mid !== filterMid) continue;
      if (c.category_minor) set.add(c.category_minor);
    }
    for (const r of rows) {
      if (filterMid && r.category_mid !== filterMid) continue;
      if (r.category_minor) set.add(r.category_minor);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [categories, rows, filterMid]);

  // KPI — 총건수 / 중분류별 상위 3 / 폐기 수 (현재 행 기준으로 실시간 파생)
  const kpi = useMemo(() => {
    const total = rows.length;
    const disposed = rows.filter((r) => r.status === "disposed").length;
    const byMid = new Map<string, number>();
    for (const r of rows) {
      const key = r.category_mid || "미분류";
      byMid.set(key, (byMid.get(key) ?? 0) + 1);
    }
    const top3 = Array.from(byMid.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    return { total, disposed, top3 };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!includeDisposed && r.status === "disposed") return false;
      if (filterMid && r.category_mid !== filterMid) return false;
      if (filterMinor && r.category_minor !== filterMinor) return false;
      if (q) {
        const hay = `${r.asset_code} ${r.sub_name} ${r.spec} ${r.serial_number} ${r.place} ${r.user_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, filterMid, filterMinor, includeDisposed]);

  // 필터가 바뀌면 1페이지로 복귀
  useEffect(() => {
    setPage(1);
  }, [search, filterMid, filterMinor, includeDisposed]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  );

  async function loadParentOptions() {
    if (parentLoaded) return;
    try {
      const res = await fetch("/api/assets");
      if (!res.ok) throw new Error();
      const list = (await res.json()) as ParentAsset[];
      setParentOptions(
        list.map((a) => ({
          id: a.id,
          asset_name: a.asset_name,
          asset_type: a.asset_type,
          ip_address: a.ip_address,
          serial_number: a.serial_number,
        }))
      );
      setParentLoaded(true);
    } catch {
      addToast("장비 목록을 불러오지 못했습니다.", "error");
    }
  }

  const parentMatches = useMemo(() => {
    const q = parentQuery.trim().toLowerCase();
    if (!q) return [];
    return parentOptions
      .filter((a) =>
        `${a.asset_name} ${a.ip_address} ${a.serial_number}`.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [parentOptions, parentQuery]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setParentId(null);
    setParentName("");
    setParentQuery("");
    setShowForm(true);
    loadParentOptions();
  }

  function openEdit(row: SubAsset) {
    setEditing(row);
    setForm({
      asset_code: row.asset_code,
      category_major: row.category_major,
      category_mid: row.category_mid,
      category_minor: row.category_minor,
      sub_name: row.sub_name,
      spec: row.spec,
      serial_number: row.serial_number,
      acquired_date: row.acquired_date,
      user_name: row.user_name,
      place: row.place,
      purpose: row.purpose,
      note: row.note,
    });
    setParentId(row.parent_asset_id);
    setParentName(row.parent_name ?? "");
    setParentQuery("");
    setShowForm(true);
    loadParentOptions();
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
    setParentId(null);
    setParentName("");
    setParentQuery("");
  }

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.sub_name.trim()) {
      addToast("자산명을 입력하세요.", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        status: editing?.status ?? "active",
        parent_asset_id: parentId,
      };
      const res = await fetch(editing ? `/api/sub-assets/${editing.id}` : "/api/sub-assets", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error);
      }
      const saved: SubAsset = await res.json();
      if (editing) {
        setRows((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
        addToast(`'${saved.sub_name}' 부속자산이 수정되었습니다.`, "success");
      } else {
        setRows((prev) => [saved, ...prev]);
        addToast(`'${saved.sub_name}' 부속자산이 등록되었습니다.`, "success");
      }
      closeForm();
    } catch (err) {
      addToast(
        err instanceof Error && err.message ? err.message : "저장에 실패했습니다.",
        "error"
      );
    } finally {
      setSaving(false);
    }
  }

  // 폐기/복원 토글 — PUT 전체 교체 규약에 맞춰 행 전체 필드를 그대로 보낸다.
  async function toggleStatus(row: SubAsset) {
    const next = row.status === "active" ? "disposed" : "active";
    const res = await fetch(`/api/sub-assets/${row.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...row, status: next }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addToast(err.error || "상태 변경에 실패했습니다.", "error");
      return;
    }
    const saved: SubAsset = await res.json();
    setRows((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
    addToast(
      next === "disposed"
        ? `'${row.sub_name}' 이(가) 폐기 처리되었습니다.`
        : `'${row.sub_name}' 이(가) 복원되었습니다.`,
      "success"
    );
  }

  async function handleDelete(row: SubAsset) {
    if (!confirm(`'${row.sub_name}' 부속자산을 삭제하시겠습니까? 삭제는 되돌릴 수 없습니다.`)) return;
    const res = await fetch(`/api/sub-assets/${row.id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addToast(err.error || "삭제에 실패했습니다.", "error");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    addToast(`'${row.sub_name}' 부속자산이 삭제되었습니다.`, "success");
  }

  // 일괄 다운로드 — 현재 팀 스코프의 부속자산을 엑셀로 (쿠키 인증이 붙는 GET 네비게이션).
  function handleDownload() {
    window.location.href = "/api/sub-assets/export";
  }

  // 일괄 업로드 — 엑셀(.xlsx) 파싱→적재 후 목록 새로고침.
  async function handleUpload(file: File) {
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/sub-assets/import", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "업로드에 실패했습니다.");
      const listRes = await fetch("/api/sub-assets");
      if (listRes.ok) setRows(await listRes.json());
      const parts = [`${data.inserted}건 등록`];
      if (data.skipped) parts.push(`${data.skipped}건 스킵`);
      if (data.teamsCreated) parts.push(`팀 ${data.teamsCreated}개 생성`);
      addToast(`부속자산 일괄 업로드 완료 — ${parts.join(" · ")}`, "success");
    } catch (err) {
      addToast(err instanceof Error && err.message ? err.message : "업로드에 실패했습니다.", "error");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="panel p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-slate-100 text-ink flex items-center justify-center">
            <Boxes className="w-5 h-5" />
          </div>
          <div>
            <p className="eyebrow">총 건수</p>
            <p className="text-2xl font-bold num">{kpi.total}건</p>
          </div>
        </div>
        <div className="panel p-4 md:col-span-2">
          <p className="eyebrow mb-2">중분류 상위 3</p>
          <div className="flex flex-wrap items-center gap-2">
            {kpi.top3.length === 0 && <span className="text-sm text-ink-3">데이터 없음</span>}
            {kpi.top3.map(([mid, cnt]) => (
              <button
                key={mid}
                onClick={() => {
                  setFilterMid(mid === "미분류" ? "" : mid);
                  setFilterMinor("");
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm bg-slate-100 text-ink hover:bg-slate-200 transition-colors"
              >
                {mid} <span className="num font-semibold">{cnt}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="panel p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-fault/10 text-fault flex items-center justify-center">
            <PackageX className="w-5 h-5" />
          </div>
          <div>
            <p className="eyebrow">폐기</p>
            <p className="text-2xl font-bold num">{kpi.disposed}건</p>
          </div>
        </div>
      </div>

      {/* 등록/수정 인라인 패널 */}
      {canWrite && showForm && (
        <form onSubmit={handleSubmit} className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">
              {editing ? `부속자산 수정 — ${editing.sub_name}` : "부속자산 등록"}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              className="p-1.5 text-ink-3 hover:text-ink transition-colors"
              title="닫기"
            >
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">자산코드</label>
              <input className="form-input w-full" value={form.asset_code}
                onChange={(e) => set("asset_code", e.target.value)} placeholder="예: SW-2026-001" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">대분류</label>
              <input className="form-input w-full" value={form.category_major}
                onChange={(e) => set("category_major", e.target.value)} placeholder="예: 부속자산" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">중분류</label>
              <input className="form-input w-full" value={form.category_mid} list="subasset-mids"
                onChange={(e) => set("category_mid", e.target.value)} placeholder="예: 소프트웨어" />
              <datalist id="subasset-mids">
                {mids.map((m) => <option key={m} value={m} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">소분류</label>
              <input className="form-input w-full" value={form.category_minor}
                onChange={(e) => set("category_minor", e.target.value)} placeholder="예: 백신" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                자산명 <span className="text-fault">*</span>
              </label>
              <input className="form-input w-full" value={form.sub_name} required
                onChange={(e) => set("sub_name", e.target.value)} placeholder="예: V3 백신 서버용 라이선스" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">규격</label>
              <input className="form-input w-full" value={form.spec}
                onChange={(e) => set("spec", e.target.value)} placeholder="예: 32GB DDR4 ECC" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">시리얼번호</label>
              <input className="form-input w-full" value={form.serial_number}
                onChange={(e) => set("serial_number", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">취득일</label>
              <input type="date" className="form-input w-full" value={form.acquired_date}
                onChange={(e) => set("acquired_date", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">사용자</label>
              <input className="form-input w-full" value={form.user_name}
                onChange={(e) => set("user_name", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">설치장소</label>
              <input className="form-input w-full" value={form.place}
                onChange={(e) => set("place", e.target.value)} placeholder="예: 전산실 A01" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">용도</label>
              <input className="form-input w-full" value={form.purpose}
                onChange={(e) => set("purpose", e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">비고</label>
              <input className="form-input w-full" value={form.note}
                onChange={(e) => set("note", e.target.value)} />
            </div>

            {/* 부모장비 연결 */}
            <div className="col-span-2 md:col-span-4 pt-2 border-t border-line">
              <label className="block text-sm font-medium text-gray-700 mb-1">부모장비 연결 (선택)</label>
              {parentId != null ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm bg-signal/10 text-signal font-medium">
                    {parentName || `#${parentId}`}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-ink-3 hover:text-fault transition-colors underline"
                    onClick={() => { setParentId(null); setParentName(""); }}
                  >
                    연결 해제
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="form-input w-64"
                    placeholder="장비명·IP·시리얼로 검색"
                    value={parentQuery}
                    onChange={(e) => setParentQuery(e.target.value)}
                  />
                  {parentQuery.trim() && (
                    <select
                      className="form-input w-72"
                      value=""
                      onChange={(e) => {
                        const pid = Number(e.target.value);
                        if (!pid) return;
                        const picked = parentOptions.find((a) => a.id === pid);
                        if (picked) {
                          setParentId(picked.id);
                          setParentName(picked.asset_name);
                        }
                      }}
                    >
                      <option value="">
                        {parentMatches.length > 0
                          ? `검색 결과 ${parentMatches.length}건 — 선택하세요`
                          : "검색 결과 없음"}
                      </option>
                      {parentMatches.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.asset_name}{a.ip_address ? ` (${a.ip_address})` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-line">
            <button type="button" className="px-3 py-2 text-sm text-ink-2 hover:text-ink transition-colors" onClick={closeForm}>
              취소
            </button>
            <button type="submit" className="btn-ink" disabled={saving}>
              {saving ? "저장 중…" : editing ? "수정 저장" : "등록"}
            </button>
          </div>
        </form>
      )}

      {/* 필터 + 테이블 */}
      <div className="panel p-5">
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">중분류</label>
            <select
              className="form-input"
              value={filterMid}
              onChange={(e) => { setFilterMid(e.target.value); setFilterMinor(""); }}
            >
              <option value="">전체</option>
              {mids.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">소분류</label>
            <select
              className="form-input"
              value={filterMinor}
              onChange={(e) => setFilterMinor(e.target.value)}
            >
              <option value="">전체</option>
              {minors.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-56">
            <label className="block text-sm font-medium text-gray-700 mb-1">검색</label>
            <input
              className="form-input w-full"
              placeholder="자산코드, 자산명, 규격, 시리얼, 설치장소, 사용자"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-ink-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeDisposed}
              onChange={(e) => setIncludeDisposed(e.target.checked)}
            />
            폐기 포함
          </label>
          <button
            type="button"
            className="px-3 py-2 text-sm rounded-lg border border-line text-ink-2 hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5"
            onClick={handleDownload}
            title="현재 목록을 엑셀로 다운로드"
          >
            <Download size={15} /> 일괄 다운로드
          </button>
          {canWrite && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                }}
              />
              <button
                type="button"
                className="px-3 py-2 text-sm rounded-lg border border-line text-ink-2 hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                title="엑셀(.xlsx)로 부속자산 일괄 등록"
              >
                <Upload size={15} /> {importing ? "업로드 중…" : "일괄 업로드"}
              </button>
              <button className="btn-ink" onClick={openCreate}>
                <Plus size={15} className="mr-1.5" /> 부속자산 등록
              </button>
            </>
          )}
          {/* 페이지 인덱스 — 필터바 우측(화면 중간 높이): 페이지 전환하러 바닥까지 스크롤하지 않도록 */}
          {filtered.length > 0 && (
            <div className="ml-auto flex items-center gap-1 pb-1 text-sm text-ink-2 whitespace-nowrap">
              <span className="num text-xs text-ink-3 mr-1">
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} / {filtered.length}건
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
            <>부속자산은 램·모듈·디스크·모니터·S/W 등 <strong className="text-ink-2">장비가 아닌 재물 품목</strong>입니다 — 랙 실장/IP 관리 대상이 아닙니다</>,
            ...(canWrite
              ? [<>부모 장비를 연결하면 '이 디스크는 어느 스토리지 소속인지' 추적됩니다</>]
              : []),
            <>중분류 KPI 카드를 누르면 해당 분류로 바로 필터됩니다</>,
            ...(canWrite
              ? [<>폐기 처리해도 이력은 남으며 <strong className="text-ink-2">'폐기 포함'</strong> 토글로 다시 볼 수 있습니다</>]
              : []),
          ]}
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-3 border-b border-line">
                <th className="py-2 pr-3 font-medium">자산코드</th>
                <th className="py-2 pr-3 font-medium">분류</th>
                <th className="py-2 pr-3 font-medium">자산명</th>
                <th className="py-2 pr-3 font-medium">규격</th>
                <th className="py-2 pr-3 font-medium">시리얼</th>
                <th className="py-2 pr-3 font-medium">취득일</th>
                <th className="py-2 pr-3 font-medium">사용자</th>
                <th className="py-2 pr-3 font-medium">설치장소</th>
                <th className="py-2 pr-3 font-medium">부모장비</th>
                <th className="py-2 pr-3 font-medium">상태</th>
                {canWrite && <th className="py-2 pr-3 font-medium">관리</th>}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.id} className="border-b border-line/60 hover:bg-slate-50/50">
                  <td className="py-2 pr-3 num whitespace-nowrap">{row.asset_code || "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-ink-2">
                    {row.category_mid || "미분류"}
                    {row.category_minor ? ` > ${row.category_minor}` : ""}
                  </td>
                  <td className="py-2 pr-3 font-medium">{row.sub_name}</td>
                  <td className="py-2 pr-3">{row.spec || "—"}</td>
                  <td className="py-2 pr-3 num">{row.serial_number || "—"}</td>
                  <td className="py-2 pr-3 num whitespace-nowrap">{row.acquired_date || "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{row.user_name || "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{row.place || "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {row.parent_name ? (
                      <span className="text-signal">{row.parent_name}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {row.status === "disposed" ? (
                      <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-ink-2">폐기</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs bg-signal/10 text-signal">사용중</span>
                    )}
                  </td>
                  {canWrite && (
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <button
                          className="p-1.5 text-ink-3 hover:text-ink transition-colors"
                          title="수정"
                          onClick={() => openEdit(row)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="p-1.5 text-ink-3 hover:text-warn transition-colors"
                          title={row.status === "active" ? "폐기 처리" : "복원"}
                          onClick={() => toggleStatus(row)}
                        >
                          {row.status === "active" ? <PackageX size={14} /> : <RotateCcw size={14} />}
                        </button>
                        <button
                          className="p-1.5 text-ink-3 hover:text-fault transition-colors"
                          title="삭제"
                          onClick={() => handleDelete(row)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={canWrite ? 11 : 10} className="py-8 text-center text-ink-3">
                    조건에 맞는 부속자산이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-line text-sm text-ink-2">
            <span className="num">
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} / {filtered.length}건
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
      </div>
    </div>
  );
}

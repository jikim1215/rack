"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { History, Plus, Save, X } from "lucide-react";
import { UsageGuide } from "@/components/UsageGuide";
import { AuditLogModal, fetchAuditLogs } from "@/components/AuditLogModal";
import { useToast } from "@/components/Toast";
import { overlaps, type RackSpan } from "@/lib/rack-overlap";

const typeColors: Record<string, string> = {
  server: "#334155",
  network: "#16a34a",
  security: "#dc2626",
  telecom: "#d97706",
  other: "#6b7280",
};
const typeLabels: Record<string, string> = {
  server: "서버", network: "네트워크", security: "정보보호", telecom: "전화설비", other: "기타",
};
const statusLabels: Record<string, string> = {
  active: "운용중", maintenance: "점검중", standby: "예비", retired: "폐기",
};
const typeAbbr: Record<string, string> = {
  server: "S", network: "N", security: "F", telecom: "T", other: "E",
};

interface Asset {
  id: number;
  asset_name: string;

  asset_type: string;
  rack_id: number;
  rack_unit_start: number;
  rack_unit_size: number;
  rack_side?: "L" | "R" | null; // 반폭 배치: L(좌)/R(우), null=전폭
  manufacturer: string;
  model: string;
  ip_address: string;
  status: string;
}

// 자산 → 겹침 판정용 구간(RackSpan) 변환 (rack-overlap.ts 공용 규칙 사용)
function spanOf(a: Asset): RackSpan {
  return { start: a.rack_unit_start, size: Math.max(1, a.rack_unit_size || 1), side: a.rack_side ?? null };
}

// 반폭 라벨 (툴팁·표시용)
const sideLabels: Record<string, string> = { L: "좌 반폭", R: "우 반폭" };

export function RackView({ locations, racks, assets, unplacedAssets = [], distFrames = [], canWrite = false, teams = [], isAdmin = false }: { locations: any[]; racks: any[]; assets: Asset[]; unplacedAssets?: Asset[]; distFrames?: { id: number; rack_id: number | null; rack_unit_start: number | null; rack_unit_size: number | null }[]; canWrite?: boolean; teams?: { id: number; team_name: string }[]; isAdmin?: boolean }) {
  const router = useRouter();
  const { addToast } = useToast();
  const [selectedLocation, setSelectedLocation] = useState<number | "">("");
  const [hoveredAsset, setHoveredAsset] = useState<Asset | null>(null);
  const [hoveredConflict, setHoveredConflict] = useState<Asset[] | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [auditLogs, setAuditLogs] = useState<any[] | null>(null);
  const [auditRackName, setAuditRackName] = useState("");
  const [rackSearch, setRackSearch] = useState("");
  const [showWarningsOnly, setShowWarningsOnly] = useState(false);
  // 랙 추가 (위치관리와 동일한 연속 추가 UX)
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<{ location_id: number; rack_name: string; total_units: number; description: string; team_id: number | "" }>({ location_id: 0, rack_name: "", total_units: 42, description: "", team_id: "" });
  const [saving, setSaving] = useState(false);
  const addNameRef = useRef<HTMLInputElement>(null);

  function openAddForm() {
    if (locations.length === 0) { addToast("먼저 위치를 등록하세요. 랙은 위치에 소속됩니다.", "error"); return; }
    setAddForm((f) => ({
      ...f,
      location_id: (selectedLocation || f.location_id || locations[0]?.id || 0) as number,
      rack_name: "",
    }));
    setShowAddForm(true);
    requestAnimationFrame(() => addNameRef.current?.focus());
  }

  async function saveNewRack() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/racks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (res.ok) {
        // 연속 추가: 위치·총유닛·설명은 유지하고 이름만 비운다.
        setAddForm((f) => ({ ...f, rack_name: "" }));
        addToast("랙 추가됨 — 이름만 입력하면 같은 위치·크기로 계속 추가됩니다.", "success");
        router.refresh();
        requestAnimationFrame(() => addNameRef.current?.focus());
      } else {
        addToast(data.error || "저장에 실패했습니다.", "error");
      }
    } finally {
      setSaving(false);
    }
  }

  // ── 드래그앤드롭 배치 ──
  const [dragAsset, setDragAsset] = useState<{ id: number; name: string; size: number; fromRackId: number | null; fromUnitStart: number | null; side: "L" | "R" | null } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ rackId: number; unit: number } | null>(null);
  const [unplacedSearch, setUnplacedSearch] = useState("");
  const [unplacedType, setUnplacedType] = useState("");
  // 우클릭 컨텍스트 메뉴 (실장된 장비 → 실장 해제). 충돌 슬롯이면 겹친 장비 전부 나열.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; assets: Asset[] } | null>(null);

  function openCtxMenu(e: React.MouseEvent, menuAssets: Asset[]) {
    if (!canWrite || menuAssets.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    setHoveredAsset(null);
    setHoveredConflict(null);
    setCtxMenu({ x: e.clientX, y: e.clientY, assets: menuAssets });
  }

  // 자산의 실장 구간과 겹치는 선번장(dist_frame) 찾기 — FDF 우클릭 → 선번장 바로가기
  function frameOfAsset(a: Asset) {
    if (a.rack_id == null || a.rack_unit_start == null) return null;
    const aEnd = a.rack_unit_start + Math.max(1, a.rack_unit_size || 1) - 1;
    return distFrames.find((f) => {
      if (f.rack_id !== a.rack_id || f.rack_unit_start == null) return false;
      const fEnd = f.rack_unit_start + Math.max(1, f.rack_unit_size || 1) - 1;
      return f.rack_unit_start <= aEnd && fEnd >= a.rack_unit_start;
    }) || null;
  }

  function canDropAt(rackId: number, totalUnits: number, unit: number): boolean {
    if (!dragAsset) return false;
    const end = unit + dragAsset.size - 1;
    if (end > totalUnits) return false;
    // 겹침 판정은 rack-overlap.ts 공용 규칙(side 포함) 사용 — 서버 SQL과 동일
    const span: RackSpan = { start: unit, size: dragAsset.size, side: dragAsset.side };
    return !assets.some((a) => a.rack_id === rackId && a.id !== dragAsset.id && overlaps(span, spanOf(a)));
  }

  // 미리보기: 드롭 대상 범위에 포함된 유닛이면 유효/무효 상태 반환
  function previewState(rackId: number, totalUnits: number, unit: number): "ok" | "bad" | null {
    if (!dragAsset || !dropTarget || dropTarget.rackId !== rackId) return null;
    if (unit < dropTarget.unit || unit > dropTarget.unit + dragAsset.size - 1) return null;
    return canDropAt(rackId, totalUnits, dropTarget.unit) ? "ok" : "bad";
  }

  function startDrag(e: React.DragEvent, a: Asset) {
    e.dataTransfer.setData("text/plain", String(a.id));
    e.dataTransfer.effectAllowed = "move";
    setDragAsset({
      id: a.id, name: a.asset_name, size: Math.max(1, a.rack_unit_size || 1),
      fromRackId: a.rack_id ?? null, fromUnitStart: a.rack_unit_start ?? null,
      side: a.rack_side ?? null,
    });
    setHoveredAsset(null);
    setHoveredConflict(null);
    setCtxMenu(null);
  }

  function endDrag() {
    setDragAsset(null);
    setDropTarget(null);
  }

  function slotDragOver(e: React.DragEvent, rackId: number, unit: number) {
    if (!dragAsset) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!dropTarget || dropTarget.rackId !== rackId || dropTarget.unit !== unit) {
      setDropTarget({ rackId, unit });
    }
  }

  function slotDrop(e: React.DragEvent, rackId: number, totalUnits: number, unit: number) {
    e.preventDefault();
    if (!dragAsset) return;
    if (canDropAt(rackId, totalUnits, unit)) {
      placeAsset(rackId, unit);
    } else {
      addToast("해당 위치에 배치할 수 없습니다 (충돌 또는 범위 초과).", "error");
      endDrag();
    }
  }

  // 배치/이동/해제 공용 처리. undoable이면 성공 토스트에 '실행 취소' 버튼을 붙인다.
  async function updatePlacement(
    target: { id: number; name: string; size: number; prevRackId: number | null; prevUnitStart: number | null },
    rackId: number | null,
    unitStart: number | null,
    opts: { undoable?: boolean } = {}
  ) {
    const res = await fetch(`/api/assets/${target.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rack_id: rackId, rack_unit_start: unitStart, rack_unit_size: target.size }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const undoAction = opts.undoable ? {
        label: "실행 취소",
        onClick: () => updatePlacement(
          { ...target, prevRackId: rackId, prevUnitStart: unitStart },
          target.prevRackId, target.prevUnitStart, { undoable: false }
        ),
      } : undefined;
      if (rackId) {
        addToast(`'${target.name}' 배치 완료 (${unitStart}U~${unitStart! + target.size - 1}U)`, "success", undoAction);
        // 라이프사이클 넛지: 실장됐지만 IP가 없으면 다음 단계(IP 부여)로 안내
        if (!(data.ip_address || "").trim()) {
          addToast(`'${target.name}'은(는) 아직 IP가 없습니다.`, "info", { label: "자산관리에서 IP 부여", href: "/assets?missing=ip" });
        }
      } else {
        addToast(`'${target.name}' 실장 해제됨`, "success", undoAction);
      }
      router.refresh();
    } else {
      addToast(data.error || "배치에 실패했습니다.", "error");
    }
  }

  async function placeAsset(rackId: number | null, unitStart: number | null) {
    if (!dragAsset) return;
    const drag = dragAsset;
    endDrag();
    await updatePlacement(
      { id: drag.id, name: drag.name, size: drag.size, prevRackId: drag.fromRackId, prevUnitStart: drag.fromUnitStart },
      rackId, unitStart, { undoable: true }
    );
  }

  function unrackFromMenu(a: Asset) {
    setCtxMenu(null);
    updatePlacement(
      { id: a.id, name: a.asset_name || "(이름없음)", size: Math.max(1, a.rack_unit_size || 1), prevRackId: a.rack_id ?? null, prevUnitStart: a.rack_unit_start ?? null },
      null, null, { undoable: true }
    );
  }

  // 랙별 경고 심각도 판정: critical(충돌) > warning(범위초과) > caution(사용률초과)
  type Severity = "critical" | "warning" | "caution" | null;
  function getRackSeverity(rackId: number, totalUnits: number): Severity {
    const ra = assets.filter((a) => a.rack_id === rackId);
    // 충돌 검사 → 치명 (side 규칙 포함: L/R 반폭은 공존 허용)
    for (let i = 0; i < ra.length; i++) {
      for (let j = i + 1; j < ra.length; j++) {
        if (overlaps(spanOf(ra[i]), spanOf(ra[j]))) return "critical";
      }
    }
    // 범위 초과 → 경고
    if (ra.some((a) => a.rack_unit_start + a.rack_unit_size - 1 > totalUnits)) return "warning";
    // 사용률 초과 → 주의
    const used = ra.reduce((s, a) => s + a.rack_unit_size, 0);
    if (used > totalUnits) return "caution";
    return null;
  }

  function hasWarning(rackId: number, totalUnits: number) {
    return getRackSeverity(rackId, totalUnits) !== null;
  }

  const filteredRacks = racks.filter((r) => {
    if (selectedLocation && r.location_id !== selectedLocation) return false;
    if (rackSearch && !r.rack_name.toLowerCase().includes(rackSearch.toLowerCase())) return false;
    if (showWarningsOnly && !hasWarning(r.id, r.total_units)) return false;
    return true;
  });

  // KPI 요약
  const kpi = {
    total: racks.length,
    critical: racks.filter((r: any) => getRackSeverity(r.id, r.total_units) === "critical").length,
    warning: racks.filter((r: any) => getRackSeverity(r.id, r.total_units) === "warning").length,
    caution: racks.filter((r: any) => getRackSeverity(r.id, r.total_units) === "caution").length,
  };
  kpi.total; // suppress unused
  const kpiIssue = kpi.critical + kpi.warning + kpi.caution;

  function getAssetsAt(rackId: number, unit: number) {
    return assets.filter(
      (a) => a.rack_id === rackId && a.rack_unit_start <= unit && a.rack_unit_start + a.rack_unit_size - 1 >= unit
    );
  }

  // 표준 랙 번호 규격: 하단이 1U, 상단이 total_units(예: 42U). 다이어그램은 위에서 아래로 내림차순 렌더.
  // 멀티U 장비의 "시각적 앵커"(블록을 그리는 행)는 장비의 최상단 유닛 = start + size - 1 (랙 상한 클램프).
  function blockAnchorUnit(asset: Asset, totalUnits: number) {
    return Math.min(asset.rack_unit_start + asset.rack_unit_size - 1, totalUnits);
  }

  return (
    <div>
      {/* KPI 요약 바 */}
      <div className="flex items-center gap-4 mb-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-ink-3">전체</span>
          <span className="num font-semibold">{kpi.total}</span>
        </div>
        {kpiIssue > 0 && (
          <>
            <span className="text-line">|</span>
            <div className="flex items-center gap-1.5">
              <span className="text-ink-3">이상</span>
              <span className="num font-semibold text-fault">{kpiIssue}</span>
            </div>
          </>
        )}
        {kpi.critical > 0 && (
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-fault" />
            <span className="text-xs text-ink-3">충돌 <span className="num text-fault">{kpi.critical}</span></span>
          </div>
        )}
        {kpi.warning > 0 && (
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-warning" />
            <span className="text-xs text-ink-3">범위초과 <span className="num text-warning">{kpi.warning}</span></span>
          </div>
        )}
        {kpi.caution > 0 && (
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-warn" />
            <span className="text-xs text-ink-3">사용률초과 <span className="num text-warn">{kpi.caution}</span></span>
          </div>
        )}
      </div>

      {/* 사용 가이드 (접기/펼치기) */}
      <UsageGuide
        className="mb-4 -mt-2 text-right"
        items={[
          <>랙 번호는 표준 규격대로 <strong className="text-ink-2">하단 1U → 상단 42U</strong>입니다. 장비 블록의 좌측 번호는 시작(최하단) U입니다</>,
          <>위치/이름으로 랙을 찾으세요</>,
          <><strong className="text-ink-2">이상 랙만 보기</strong>를 켜면 충돌·초과 경고가 있는 랙만 표시됩니다</>,
          <>장비 위에 마우스를 올리면 상세 정보가 보입니다</>,
          ...(canWrite
            ? [
                <><strong className="text-ink-2">미배치 자산</strong>을 끌어 랙 슬롯에 놓으면 배치되고, 실장된 장비를 끌어 옮기거나 미배치 패널에 놓아 해제할 수 있습니다</>,
                <>드래그로 놓은 칸이 장비의 <strong className="text-ink-2">시작(최하단) U</strong>가 되고, 멀티U 장비는 그 위로 올라갑니다</>,
                <>실장된 장비를 <strong className="text-ink-2">마우스 우클릭</strong>하면 바로 실장 해제할 수 있고, 배치 직후 토스트의 <strong className="text-ink-2">실행 취소</strong>로 되돌릴 수 있습니다</>,
              ]
            : []),
        ]}
      />

      {/* 위치 필터 */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <span className="text-sm text-ink-3">위치:</span>
        <select
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value ? Number(e.target.value) : "")}
          className="form-input text-sm"
        >
          <option value="">전체</option>
          {locations.map((l: any) => (
            <option key={l.id} value={l.id}>{l.location_name}</option>

          ))}
        </select>
        <input
          type="text"
          placeholder="랙 이름 검색..."
          value={rackSearch}
          onChange={(e) => setRackSearch(e.target.value)}
          className="form-input text-sm w-40"
        />
        <label className="flex items-center gap-1.5 text-sm text-ink-2 cursor-pointer">
          <input type="checkbox" checked={showWarningsOnly} onChange={(e) => setShowWarningsOnly(e.target.checked)}
            className="rounded border-line" />
          이상 랙만 보기
        </label>
        {canWrite && (
          <button onClick={openAddForm} className="btn-ink flex items-center gap-1 px-3 py-1.5 text-sm">
            <Plus size={14} /> 랙 추가
          </button>
        )}
        <div className="flex gap-3 ml-auto text-xs text-ink-2 whitespace-nowrap">
          {Object.entries(typeColors).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
              <span>{typeLabels[type]}</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-surface border border-line-strong" />
            <span>빈 슬롯</span>
          </div>
        </div>
      </div>

      {/* 랙 추가 폼 (연속 추가: 저장 후 이름만 비워짐) */}
      {showAddForm && canWrite && (
        <div className="panel p-4 mb-6 max-w-2xl">
          <div className="flex justify-between mb-3">
            <h4 className="font-medium text-sm">랙 추가</h4>
            <button onClick={() => setShowAddForm(false)} className="text-ink-2 hover:text-ink hover:bg-slate-100 rounded p-1"><X size={16} /></button>
          </div>
          <p className="text-xs text-ink-3 mb-2">저장하면 <b>이름만</b> 비워지고 위치·총 유닛·설명은 유지됩니다. 이름만 바꿔 Enter 또는 저장으로 같은 위치·크기의 랙을 연속 추가하세요.</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs text-slate-500">위치</span>
              <select value={addForm.location_id} onChange={(e) => setAddForm({ ...addForm, location_id: Number(e.target.value) })} className="form-input">
                {locations.map((l: any) => <option key={l.id} value={l.id}>{l.location_name}</option>)}
              </select></label>
            <label className="block"><span className="text-xs text-slate-500">이름</span>
              <input ref={addNameRef} value={addForm.rack_name} onChange={(e) => setAddForm({ ...addForm, rack_name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveNewRack(); } }} className="form-input" /></label>
            <label className="block"><span className="text-xs text-slate-500">총 유닛 수</span>
              <select value={addForm.total_units} onChange={(e) => setAddForm({ ...addForm, total_units: Number(e.target.value) })} className="form-input">
                <option value={4}>4U (소형)</option>
                <option value={9}>9U</option>
                <option value={12}>12U</option>
                <option value={15}>15U</option>
                <option value={18}>18U</option>
                <option value={22}>22U</option>
                <option value={24}>24U (하프랙)</option>
                <option value={27}>27U</option>
                <option value={32}>32U</option>
                <option value={37}>37U</option>
                <option value={42}>42U (표준랙)</option>
                <option value={45}>45U</option>
                <option value={47}>47U</option>
                <option value={48}>48U</option>
              </select></label>
            <label className="block"><span className="text-xs text-slate-500">설명</span>
              <input value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} className="form-input" /></label>
            {isAdmin && (
              <label className="block"><span className="text-xs text-slate-500">소유 팀</span>
                <select value={addForm.team_id} onChange={(e) => setAddForm({ ...addForm, team_id: e.target.value === "" ? "" : Number(e.target.value) })} className="form-input">
                  <option value="">공유(미지정) — 공용센터 공용 랙</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.team_name}</option>)}
                </select></label>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={saveNewRack} disabled={saving} className="btn-ink flex items-center gap-1 px-3 py-1.5 text-sm disabled:opacity-50"><Save size={14} /> 저장</button>
            <button onClick={() => setShowAddForm(false)} className="px-3 py-1.5 border border-line rounded text-sm text-ink-2 hover:text-ink hover:bg-slate-100">닫기</button>
          </div>
        </div>
      )}

      {/* 미배치 자산 패널 + 랙들 */}
      <div className="flex gap-6 items-start">
        {canWrite && (
          <div
            className={`panel p-3 w-56 shrink-0 ${dragAsset && dragAsset.fromRackId ? "ring-2 ring-signal" : ""}`}
            onDragOver={(e) => {
              if (dragAsset && dragAsset.fromRackId) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragAsset && dragAsset.fromRackId) placeAsset(null, null);
            }}
          >
            <h4 className="font-medium text-sm mb-1">미배치 자산 <span className="num text-ink-3">{unplacedAssets.length}</span></h4>
            <p className="text-[11px] text-ink-3 mb-2">자산을 끌어 랙 슬롯에 놓으면 배치됩니다. 실장된 장비를 이 패널에 놓으면 해제됩니다.</p>
            <div className="flex gap-1 mb-2">
              <input value={unplacedSearch} onChange={(e) => setUnplacedSearch(e.target.value)} placeholder="자산 검색..." className="form-input text-xs flex-1 min-w-0" />
              <select value={unplacedType} onChange={(e) => setUnplacedType(e.target.value)} className="form-input text-xs shrink-0" style={{ width: 88 }} title="유형 필터">
                <option value="">전체</option>
                {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="space-y-1 max-h-[65vh] overflow-y-auto">
              {unplacedAssets
                .filter((a) => !unplacedType || a.asset_type === unplacedType)
                .filter((a) => !unplacedSearch || `${a.asset_name} ${a.model} ${a.manufacturer}`.toLowerCase().includes(unplacedSearch.toLowerCase()))
                .map((a) => (
                  <div
                    key={a.id}
                    draggable
                    onDragStart={(e) => startDrag(e, a)}
                    onDragEnd={endDrag}
                    className={`px-2 py-1.5 rounded bg-surface border border-line text-xs cursor-grab active:cursor-grabbing hover:bg-slate-100 ${dragAsset?.id === a.id ? "opacity-40" : ""}`}
                    style={{ borderLeft: `3px solid ${typeColors[a.asset_type] || typeColors.other}` }}
                    title={`${typeLabels[a.asset_type] || a.asset_type} · ${a.manufacturer} ${a.model}`}
                  >
                    <div className="font-medium text-ink truncate">{a.asset_name || a.model || "(이름없음)"}</div>
                    <div className="text-ink-3 flex justify-between">
                      <span>{typeLabels[a.asset_type] || a.asset_type}</span>
                      <span className="num">{Math.max(1, a.rack_unit_size || 1)}U</span>
                    </div>
                  </div>
                ))}
              {unplacedAssets.length === 0 && (
                <div className="text-[11px] text-ink-3 py-2 text-center">미배치 자산이 없습니다.</div>
              )}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-6 relative flex-1">
        {filteredRacks.map((rack: any) => {
          const rackAssets = assets.filter((a) => a.rack_id === rack.id);
          const usedUnits = rackAssets.reduce((sum, a) => sum + a.rack_unit_size, 0);
          const usagePercent = Math.round((usedUnits / rack.total_units) * 100);

          // 슬롯 충돌 감지 — 충돌 관련 장비 수 기준 (side 규칙 포함: L/R 반폭 공존은 충돌 아님)
          const conflictAssetIds = new Set<number>();
          for (let i = 0; i < rackAssets.length; i++) {
            for (let j = i + 1; j < rackAssets.length; j++) {
              if (overlaps(spanOf(rackAssets[i]), spanOf(rackAssets[j]))) {
                conflictAssetIds.add(rackAssets[i].id);
                conflictAssetIds.add(rackAssets[j].id);
              }
            }
          }
          const conflictCount = conflictAssetIds.size;

          // 랙 범위 초과 자산 감지
          const overflowing = rackAssets.filter(a =>
            a.rack_unit_start + a.rack_unit_size - 1 > rack.total_units
          );

          return (
            <div key={rack.id} className="panel p-4 hover-card">
              <div className="text-center mb-3">
                <div className="flex items-center justify-center gap-1">
                  <h3 className="font-bold text-sm text-ink">{rack.rack_name}</h3>
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    const logs = await fetchAuditLogs("rack", rack.id);
                    if (logs) { setAuditLogs(logs); setAuditRackName(rack.rack_name); }
                  }} className="text-ink-3 hover:text-ink hover:bg-slate-100 p-0.5 rounded" title="변경이력"><History size={12} /></button>
                </div>
                <p className="text-xs text-ink-3">{rack.location_name}</p>
                <p className="text-[10px] mt-0.5">
                  {rack.owner_team_name
                    ? <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">전용 · {rack.owner_team_name}</span>
                    : <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">공유</span>}
                </p>
                <p className="text-xs text-ink-2 mt-1">
                  <span className="num">{usedUnits}U</span> / <span className="num">{rack.total_units}U</span> (<span className="num">{usagePercent}%</span>)
                  {usedUnits > rack.total_units && (
                    <span className="text-fault font-bold ml-1">⚠ 초과</span>
                  )}
                </p>
              </div>

              {/* 경고 영역 — 심각도: 치명(빨강) > 경고(주황) > 주의(노랑) */}
              {(conflictCount > 0 || overflowing.length > 0 || usagePercent > 100) && (
                <div className="space-y-1 mb-2">
                  {conflictCount > 0 && (
                    <div className="text-xs text-fault bg-red-50/10 rounded px-2 py-1">
                      <span className="led led-fault" /><strong>치명</strong> · 슬롯 충돌 장비 <span className="num">{conflictCount}</span>대
                      <a href={`/assets?rack_id=${rack.id}`}
                        className="block text-fault/70 hover:text-fault mt-0.5 underline">
                        → 자산관리에서 배치 수정
                      </a>
                    </div>
                  )}
                  {overflowing.length > 0 && (
                    <div className="text-xs text-warning bg-orange-50/10 rounded px-2 py-1">
                      <span className="led led-warn" /><strong>경고</strong> · 범위 초과 <span className="num">{overflowing.length}</span>건
                      <a href={`/assets?rack_id=${rack.id}`}
                        className="block text-warning/70 hover:text-warning mt-0.5 underline">
                        → 자산관리에서 유닛 위치 확인
                      </a>
                    </div>
                  )}
                  {usagePercent > 100 && !conflictCount && (
                    <div className="text-xs text-warn bg-amber-50/10 rounded px-2 py-1">
                      <span className="led led-warn" /><strong>주의</strong> · 사용률 <span className="num">{usagePercent}%</span> 초과
                      <span className="block text-ink-3 mt-0.5">→ 랙 증설 또는 장비 재배치를 검토하세요</span>
                    </div>
                  )}
                </div>
              )}

              {/* 랙 다이어그램 */}
              <div className="border-2 border-slate-700 rounded bg-slate-800 p-0.5" style={{ width: 220 }}>
                {Array.from({ length: rack.total_units }, (_, i) => {
                  const unit = rack.total_units - i; // 상단 42U → 하단 1U (표준 랙 번호)
                  const assetsAtUnit = getAssetsAt(rack.id, unit);
                  const asset = assetsAtUnit[0] || null;
                  // 실제 충돌 여부 — overlaps() 공용 규칙(side 포함): 같은 U라도 L/R 반폭 공존은 충돌 아님
                  const hasConflict = assetsAtUnit.some((a, ai) => assetsAtUnit.some((b, bi) => bi > ai && overlaps(spanOf(a), spanOf(b))));
                  const pv = previewState(rack.id, rack.total_units, unit);
                  const pvStyle = pv === "ok"
                    ? { boxShadow: "inset 0 0 0 2px #22c55e", backgroundColor: "rgba(34,197,94,0.25)" }
                    : pv === "bad"
                      ? { boxShadow: "inset 0 0 0 2px #ef4444", backgroundColor: "rgba(239,68,68,0.25)" }
                      : {};
                  const dndProps = canWrite ? {
                    onDragOver: (e: React.DragEvent) => slotDragOver(e, rack.id, unit),
                    onDrop: (e: React.DragEvent) => slotDrop(e, rack.id, rack.total_units, unit),
                  } : {};


                  if (hasConflict) {
                    // 충돌 시 빨간 점멸 패턴
                    return (
                      <div
                        key={unit}
                        className="flex items-center rounded-sm cursor-pointer relative"
                        style={{
                          height: 24,
                          background: 'repeating-linear-gradient(45deg, #ef4444, #ef4444 5px, #fca5a5 5px, #fca5a5 10px)',
                          marginBottom: 1,
                          ...pvStyle,
                        }}
                        {...dndProps}
                        onContextMenu={(e) => openCtxMenu(e, assetsAtUnit)}
                        onMouseEnter={(e) => {
                          if (dragAsset) return;
                          setHoveredAsset(null);
                          setHoveredConflict(assetsAtUnit);
                          setTooltipPos({ x: e.clientX + 10, y: e.clientY - 10 });
                        }}
                        onMouseMove={(e) => {
                          setTooltipPos({ x: e.clientX + 10, y: e.clientY - 10 });
                        }}
                        onMouseLeave={() => setHoveredConflict(null)}
                      >
                        <span className="num text-[10px] text-white w-7 text-center shrink-0">{unit}U</span>
                        <span className="text-xs text-white font-bold truncate px-1">⚠ {assetsAtUnit.map(a => a.asset_name).join(", ")}</span>
                      </div>
                    );
                  }

                  // 반폭(L/R) 자산 렌더 — 같은 U에 L/R 두 대면 가로 반반, 단독 반폭은 해당 방향 절반 + 반대쪽 빈칸
                  const halves = assetsAtUnit.filter((a) => a.rack_side === "L" || a.rack_side === "R");
                  if (halves.length > 0) {
                    const leftA = assetsAtUnit.find((a) => a.rack_side === "L") || null;
                    const rightA = assetsAtUnit.find((a) => a.rack_side === "R") || null;
                    const renderHalf = (a: Asset | null) => a ? (
                      <div
                        draggable={canWrite}
                        onDragStart={(e) => startDrag(e, a)}
                        onDragEnd={endDrag}
                        onContextMenu={(e) => openCtxMenu(e, [a])}
                        className={`flex items-center rounded-sm hover-rack-item flex-1 min-w-0 ${canWrite ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${dragAsset?.id === a.id ? "opacity-40" : ""}`}
                        style={{ backgroundColor: typeColors[a.asset_type] || typeColors.other }}
                        onMouseEnter={(e) => {
                          if (dragAsset) return;
                          setHoveredAsset(a);
                          setTooltipPos({ x: e.clientX + 10, y: e.clientY - 10 });
                        }}
                        onMouseMove={(e) => setTooltipPos({ x: e.clientX + 10, y: e.clientY - 10 })}
                        onMouseLeave={() => setHoveredAsset(null)}
                      >
                        {unit === blockAnchorUnit(a, rack.total_units) && (
                          <span className="text-[10px] text-white font-medium truncate px-1">
                            <span className="text-white/50 mr-0.5">{typeAbbr[a.asset_type] || "?"}</span>{a.asset_name}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex-1 rounded-sm" style={{ backgroundColor: "rgba(255,255,255,0.05)" }} />
                    );
                    return (
                      <div
                        key={unit}
                        className="flex items-stretch gap-px rounded-sm relative"
                        style={{ height: 24, marginBottom: 1, ...pvStyle }}
                        {...dndProps}
                      >
                        <span className="num text-[10px] text-slate-500 w-7 text-center shrink-0 self-center">{unit}U</span>
                        {renderHalf(leftA)}
                        {renderHalf(rightA)}
                      </div>
                    );
                  }


                  if (asset) {
                    if (unit !== blockAnchorUnit(asset, rack.total_units)) {
                      return null; // 멀티U 장비(전폭)는 최상단(앵커) 행에서 한 번만 그린다
                    }
                    // 범위초과 장비는 랙 상한에서 클램프된 높이로 표시 (경고 배지가 별도 안내)
                    const visibleUnits = unit - Math.max(asset.rack_unit_start, 1) + 1;
                    const height = visibleUnits * 24;
                    return (
                      <div
                        key={unit}
                        draggable={canWrite}
                        onDragStart={(e) => startDrag(e, asset)}
                        onDragEnd={endDrag}
                        onContextMenu={(e) => openCtxMenu(e, [asset])}
                        className={`flex items-center rounded-sm hover-rack-item relative ${canWrite ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${dragAsset?.id === asset.id ? "opacity-40" : ""}`}
                        style={{
                          height,
                          backgroundColor: typeColors[asset.asset_type] || typeColors.other,
                          marginBottom: 1,
                          ...pvStyle,
                        }}
                        {...dndProps}
                        onMouseEnter={(e) => {
                          if (dragAsset) return;
                          setHoveredAsset(asset);
                          setTooltipPos({ x: e.clientX + 10, y: e.clientY - 10 });
                        }}
                        onMouseMove={(e) => {
                          setTooltipPos({ x: e.clientX + 10, y: e.clientY - 10 });
                        }}
                        onMouseLeave={() => setHoveredAsset(null)}
                      >
                        <span className="num text-[10px] text-white/60 w-7 text-center shrink-0">{asset.rack_unit_start}U</span>
                        <span className="text-xs text-white font-medium truncate px-1"><span className="text-white/50 mr-0.5">{typeAbbr[asset.asset_type] || "?"}</span>{asset.asset_name}</span>
                        {/* FDF 어포던스 (외부 검토 R2-4 합의): 배선반 연결 장비는 선번장 진입 가능함을 블록에서 바로 보이게 */}
                        {frameOfAsset(asset) && (
                          <span className="text-[9px] bg-white/25 rounded px-1 ml-1 shrink-0" title="우클릭 → 선번장 열기">선번장</span>
                        )}
                        <span className="num text-[10px] text-white/60 ml-auto pr-1 shrink-0">{asset.rack_unit_size}U</span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={unit}
                      className="flex items-center rounded-sm"
                      style={{
                        height: 24,
                        backgroundColor: "rgba(255,255,255,0.05)",
                        marginBottom: 1,
                        ...pvStyle,
                      }}
                      {...dndProps}
                    >
                      <span className="num text-[10px] text-slate-500 w-7 text-center">{unit}U</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {filteredRacks.length === 0 && (
          <div className="text-ink-3 text-sm p-8">등록된 랙이 없습니다.</div>
        )}
        </div>
      </div>

      {/* 툴팁 */}
      {hoveredAsset && (
        <div
          className="fixed z-50 bg-rail text-white p-3 rounded-lg shadow-xl text-xs max-w-xs pointer-events-none"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="font-bold mb-1">{hoveredAsset.asset_name}</div>
          <div className="space-y-0.5 text-white/70">
            <div>유형: {typeLabels[hoveredAsset.asset_type] || hoveredAsset.asset_type}</div>
            <div>제조사: {hoveredAsset.manufacturer} {hoveredAsset.model}</div>
            <div>IP: <span className="num">{hoveredAsset.ip_address || "-"}</span></div>
            <div>위치: <span className="num">{hoveredAsset.rack_unit_start}U ~ {hoveredAsset.rack_unit_start + hoveredAsset.rack_unit_size - 1}U ({hoveredAsset.rack_unit_size}U)</span>{hoveredAsset.rack_side ? ` · ${sideLabels[hoveredAsset.rack_side]}` : ""}</div>
            <div>상태: {statusLabels[hoveredAsset.status]}</div>
          </div>
          {/* 숨은 상호작용 상시 노출 (외부 검토 R2-2 합의): 우클릭 발견성 */}
          {canWrite && (
            <div className="mt-1.5 pt-1.5 border-t border-white/20 text-white/60">
              드래그: 이동 · 우클릭: 실장 해제{frameOfAsset(hoveredAsset) ? " / 선번장 열기" : ""}
            </div>
          )}
        </div>
      )}

      {/* 충돌 툴팁 */}
      {hoveredConflict && (
        <div
          className="fixed z-50 bg-red-900 text-white p-3 rounded-lg shadow-xl text-xs max-w-sm pointer-events-none"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="font-bold mb-1 text-red-200">⚠ 충돌 장비 <span className="num">{hoveredConflict.length}</span>대</div>
          {hoveredConflict.map((a) => (
            <div key={a.id} className="border-t border-red-700 pt-1 mt-1">
              <div className="font-medium">{a.asset_name}</div>
              <div className="text-red-300">{typeLabels[a.asset_type] || a.asset_type} · <span className="num">{a.rack_unit_start}~{a.rack_unit_start + a.rack_unit_size - 1}U</span>{a.rack_side ? ` · ${sideLabels[a.rack_side]}` : " · 전폭"} · {statusLabels[a.status]}</div>
            </div>
          ))}
        </div>
      )}

      {/* 우클릭 컨텍스트 메뉴: 실장 해제 */}
      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
          />
          <div
            className="fixed z-50 bg-panel border border-line rounded-lg shadow-xl py-1 min-w-48 text-sm"
            style={{ left: Math.min(ctxMenu.x, typeof window !== "undefined" ? window.innerWidth - 220 : ctxMenu.x), top: ctxMenu.y }}
          >
            {ctxMenu.assets.map((a) => {
              const frame = frameOfAsset(a);
              return (
                <div key={a.id} className={ctxMenu.assets.length > 1 ? "border-b border-line last:border-b-0" : ""}>
                  <div className="px-3 pt-1.5 pb-0.5 text-xs text-ink-3 truncate flex justify-between gap-2">
                    <span className="truncate">{a.asset_name || a.model || "(이름없음)"}</span>
                    <span className="num shrink-0">{a.rack_unit_start}~{a.rack_unit_start + a.rack_unit_size - 1}U</span>
                  </div>
                  <button
                    onClick={() => { setCtxMenu(null); router.push(`/assets?q=${encodeURIComponent(a.asset_name || a.model || "")}`); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-surface text-ink-2 hover:text-ink"
                  >
                    자산관리에서 열기
                  </button>
                  {frame && (
                    <button
                      onClick={() => { setCtxMenu(null); router.push(`/distribution?frame=${frame.id}`); }}
                      className="w-full text-left px-3 py-1.5 hover:bg-surface text-signal"
                    >
                      선번장 열기 (배선현황)
                    </button>
                  )}
                  <button
                    onClick={() => unrackFromMenu(a)}
                    className="w-full text-left px-3 py-1.5 hover:bg-surface text-fault"
                  >
                    실장 해제
                  </button>
                </div>
              );
            })}
            <div className="border-t border-line mt-1 pt-1">
              <button onClick={() => setCtxMenu(null)} className="w-full text-left px-3 py-1.5 text-ink-3 hover:bg-surface">닫기</button>
            </div>
          </div>
        </>
      )}

      {/* 랙 이력 모달 (공통 컴포넌트) */}
      {auditLogs !== null && (
        <AuditLogModal logs={auditLogs} title={auditRackName} onClose={() => setAuditLogs(null)} />
      )}
    </div>
  );
}

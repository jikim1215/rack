"use client";

import { Plus } from "lucide-react";
import { UsageGuide } from "@/components/UsageGuide";
import type { Location, Rack, Asset } from "./types";
import { getRackSeverity, typeColors, typeLabels } from "./placement";

interface RackFilterBarProps {
  racks: Rack[];
  assets: Asset[];
  locations: Location[];
  selectedLocation: number | "";
  setSelectedLocation: (val: number | "") => void;
  rackSearch: string;
  setRackSearch: (val: string) => void;
  showWarningsOnly: boolean;
  setShowWarningsOnly: (val: boolean) => void;
  canWrite: boolean;
  onOpenAddForm: () => void;
}

export function RackFilterBar({
  racks,
  assets,
  locations,
  selectedLocation,
  setSelectedLocation,
  rackSearch,
  setRackSearch,
  showWarningsOnly,
  setShowWarningsOnly,
  canWrite,
  onOpenAddForm,
}: RackFilterBarProps) {
  // KPI 요약
  const kpi = {
    total: racks.length,
    critical: racks.filter((r) => getRackSeverity(r.id, r.total_units, assets) === "critical").length,
    warning: racks.filter((r) => getRackSeverity(r.id, r.total_units, assets) === "warning").length,
    caution: racks.filter((r) => getRackSeverity(r.id, r.total_units, assets) === "caution").length,
  };
  const kpiIssue = kpi.critical + kpi.warning + kpi.caution;

  return (
    <>
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
          {locations.map((l) => (
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
          <button onClick={onOpenAddForm} className="btn-ink flex items-center gap-1 px-3 py-1.5 text-sm">
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
    </>
  );
}

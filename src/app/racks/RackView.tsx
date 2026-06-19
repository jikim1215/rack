"use client";

import { useState } from "react";
import { History, ChevronDown, ChevronUp } from "lucide-react";
import { AuditLogModal, fetchAuditLogs } from "@/components/AuditLogModal";

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
  active: "운용중", inactive: "미사용", maintenance: "점검중", decommissioned: "폐기", eos: "EoS(단종)",
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
  manufacturer: string;
  model: string;
  ip_address: string;
  status: string;
}

export function RackView({ locations, racks, assets }: { locations: any[]; racks: any[]; assets: Asset[] }) {
  const [selectedLocation, setSelectedLocation] = useState<number | "">("");
  const [hoveredAsset, setHoveredAsset] = useState<Asset | null>(null);
  const [hoveredConflict, setHoveredConflict] = useState<Asset[] | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [auditLogs, setAuditLogs] = useState<any[] | null>(null);
  const [auditRackName, setAuditRackName] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [rackSearch, setRackSearch] = useState("");
  const [showWarningsOnly, setShowWarningsOnly] = useState(false);

  // 랙별 경고 심각도 판정: critical(충돌) > warning(범위초과) > caution(사용률초과)
  type Severity = "critical" | "warning" | "caution" | null;
  function getRackSeverity(rackId: number, totalUnits: number): Severity {
    const ra = assets.filter((a) => a.rack_id === rackId);
    // 충돌 검사 → 치명
    for (let i = 0; i < ra.length; i++) {
      for (let j = i + 1; j < ra.length; j++) {
        const e1 = ra[i].rack_unit_start + ra[i].rack_unit_size - 1;
        const e2 = ra[j].rack_unit_start + ra[j].rack_unit_size - 1;
        if (ra[i].rack_unit_start <= e2 && ra[j].rack_unit_start <= e1) return "critical";
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

  function isTopUnit(asset: Asset, unit: number) {
    return asset.rack_unit_start === unit;
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
        <button onClick={() => setShowGuide(!showGuide)} className="ml-auto text-xs text-ink-3 hover:text-ink flex items-center gap-1">
          사용법 {showGuide ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* 사용 가이드 (접기/펼치기) */}
      {showGuide && (
        <div className="text-xs text-ink-3 mb-4 space-y-0.5 border-l-2 border-line pl-3">
          <p>• 위치/이름으로 랙을 찾으세요</p>
          <p>• <strong className="text-ink-2">이상 랙만 보기</strong>를 켜면 충돌·초과 경고가 있는 랙만 표시됩니다</p>
          <p>• 장비 위에 마우스를 올리면 상세 정보가 보입니다</p>
        </div>
      )}

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

      {/* 랙들 */}
      <div className="flex flex-wrap gap-6 relative">
        {filteredRacks.map((rack: any) => {
          const rackAssets = assets.filter((a) => a.rack_id === rack.id);
          const usedUnits = rackAssets.reduce((sum, a) => sum + a.rack_unit_size, 0);
          const usagePercent = Math.round((usedUnits / rack.total_units) * 100);

          // 슬롯 충돌 감지 — 충돌 관련 장비 수 기준
          const conflictAssetIds = new Set<number>();
          for (let i = 0; i < rackAssets.length; i++) {
            for (let j = i + 1; j < rackAssets.length; j++) {
              const a1 = rackAssets[i], a2 = rackAssets[j];
              const a1End = a1.rack_unit_start + a1.rack_unit_size - 1;
              const a2End = a2.rack_unit_start + a2.rack_unit_size - 1;
              if (a1.rack_unit_start <= a2End && a2.rack_unit_start <= a1End) {
                conflictAssetIds.add(a1.id);
                conflictAssetIds.add(a2.id);
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
                  const unit = i + 1;
                  const assetsAtUnit = getAssetsAt(rack.id, unit);
                  const asset = assetsAtUnit[0] || null;
                  const hasConflict = assetsAtUnit.length > 1;

                  if (asset && !hasConflict && !isTopUnit(asset, unit)) {
                    return null; // 멀티U 장비의 하단 슬롯은 렌더링 건너뜀
                  }

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
                        }}
                        onMouseEnter={(e) => {
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

                  if (asset) {
                    const height = asset.rack_unit_size * 24;
                    return (
                      <div
                        key={unit}
                        className="flex items-center rounded-sm cursor-pointer hover-rack-item relative"
                        style={{
                          height,
                          backgroundColor: typeColors[asset.asset_type] || typeColors.other,
                          marginBottom: 1,
                        }}
                        onMouseEnter={(e) => {
                          setHoveredAsset(asset);
                          setTooltipPos({ x: e.clientX + 10, y: e.clientY - 10 });
                        }}
                        onMouseMove={(e) => {
                          setTooltipPos({ x: e.clientX + 10, y: e.clientY - 10 });
                        }}
                        onMouseLeave={() => setHoveredAsset(null)}
                      >
                        <span className="num text-[10px] text-white/60 w-7 text-center shrink-0">{unit}U</span>
                        <span className="text-xs text-white font-medium truncate px-1"><span className="text-white/50 mr-0.5">{typeAbbr[asset.asset_type] || "?"}</span>{asset.asset_name}</span>

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
                      }}
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

      {/* 툴팁 */}
      {hoveredAsset && (
        <div
          className="fixed z-50 bg-rail text-white p-3 rounded-lg shadow-xl text-xs max-w-xs pointer-events-none"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="font-bold mb-1">{hoveredAsset.asset_name}</div>
          <div className="space-y-0.5 text-white/70">
            <div>유형: {typeLabels[hoveredAsset.asset_type]}</div>
            <div>제조사: {hoveredAsset.manufacturer} {hoveredAsset.model}</div>
            <div>IP: <span className="num">{hoveredAsset.ip_address || "-"}</span></div>
            <div>위치: <span className="num">{hoveredAsset.rack_unit_start}U ~ {hoveredAsset.rack_unit_start + hoveredAsset.rack_unit_size - 1}U ({hoveredAsset.rack_unit_size}U)</span></div>
            <div>상태: {statusLabels[hoveredAsset.status]}</div>
          </div>
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
              <div className="text-red-300">{typeLabels[a.asset_type]} · <span className="num">{a.rack_unit_start}~{a.rack_unit_start + a.rack_unit_size - 1}U</span> · {statusLabels[a.status]}</div>
            </div>
          ))}
        </div>
      )}

      {/* 랙 이력 모달 (공통 컴포넌트) */}
      {auditLogs !== null && (
        <AuditLogModal logs={auditLogs} title={auditRackName} onClose={() => setAuditLogs(null)} />
      )}
    </div>
  );
}

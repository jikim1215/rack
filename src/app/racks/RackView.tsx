"use client";

import { useState } from "react";

const typeColors: Record<string, string> = {
  server: "#3b82f6",
  network: "#22c55e",
  security: "#ef4444",
  telecom: "#f97316",
  other: "#6b7280",
};
const typeLabels: Record<string, string> = {
  server: "서버", network: "네트워크", security: "정보보호", telecom: "전화설비", other: "기타",
};
const statusLabels: Record<string, string> = {
  active: "운용중", inactive: "미사용", maintenance: "점검중", decommissioned: "폐기", eos: "EoS(단종)",
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
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const filteredRacks = selectedLocation
    ? racks.filter((r) => r.location_id === selectedLocation)
    : racks;

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
      {/* 위치 필터 */}
      <div className="flex items-center gap-3 mb-6">
        <span className="text-sm text-slate-500">위치:</span>
        <select
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value ? Number(e.target.value) : "")}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">전체</option>
          {locations.map((l: any) => (
            <option key={l.id} value={l.id}>{l.location_name}</option>

          ))}
        </select>
        <div className="flex gap-3 ml-auto text-xs">
          {Object.entries(typeColors).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
              <span>{typeLabels[type]}</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-slate-100 border border-slate-300" />
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

          // 슬롯 충돌 감지
          const conflicts: { a1: Asset; a2: Asset }[] = [];
          for (let i = 0; i < rackAssets.length; i++) {
            for (let j = i + 1; j < rackAssets.length; j++) {
              const a1 = rackAssets[i], a2 = rackAssets[j];
              const a1End = a1.rack_unit_start + a1.rack_unit_size - 1;
              const a2End = a2.rack_unit_start + a2.rack_unit_size - 1;
              if (a1.rack_unit_start <= a2End && a2.rack_unit_start <= a1End) {
                conflicts.push({ a1, a2 });
              }
            }
          }

          // 랙 범위 초과 자산 감지
          const overflowing = rackAssets.filter(a =>
            a.rack_unit_start + a.rack_unit_size - 1 > rack.total_units
          );

          return (
            <div key={rack.id} className="bg-white border rounded-lg p-4 hover-card">
              <div className="text-center mb-3">
                <h3 className="font-bold text-sm">{rack.rack_name}</h3>

                <p className="text-xs text-slate-400">{rack.location_name}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {usedUnits}U / {rack.total_units}U ({usagePercent}%)
                  {usedUnits > rack.total_units && (
                    <span className="text-red-600 font-bold ml-1">⚠ 초과</span>
                  )}
                </p>
              </div>

              {/* 경고 영역 */}
              {(conflicts.length > 0 || overflowing.length > 0 || usagePercent > 100) && (
                <div className="space-y-1 mb-2">
                  {conflicts.length > 0 && (
                    <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                      ⚠ 슬롯 충돌 {conflicts.length}건
                    </div>
                  )}
                  {overflowing.length > 0 && (
                    <div className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1">
                      ⚠ 범위 초과 {overflowing.length}건
                    </div>
                  )}
                  {usagePercent > 100 && (
                    <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                      ⚠ 사용률 {usagePercent}% 초과
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
                        title={`⚠ 충돌: ${assetsAtUnit.map(a => a.asset_name).join(", ")}`}
                        onMouseEnter={(e) => {
                          setHoveredAsset(null);
                          setTooltipPos({ x: e.clientX + 10, y: e.clientY - 10 });
                        }}
                        onMouseMove={(e) => {
                          setTooltipPos({ x: e.clientX + 10, y: e.clientY - 10 });
                        }}
                        onMouseLeave={() => setHoveredAsset(null)}
                      >
                        <span className="text-[10px] text-white w-7 text-center shrink-0">{unit}U</span>
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
                        <span className="text-[10px] text-white/60 w-7 text-center shrink-0">{unit}U</span>
                        <span className="text-xs text-white font-medium truncate px-1">{asset.asset_name}</span>

                        <span className="text-[10px] text-white/60 ml-auto pr-1 shrink-0">{asset.rack_unit_size}U</span>
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
                      <span className="text-[10px] text-slate-500 w-7 text-center">{unit}U</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {filteredRacks.length === 0 && (
          <div className="text-slate-400 text-sm p-8">등록된 랙이 없습니다.</div>
        )}
      </div>

      {/* 툴팁 */}
      {hoveredAsset && (
        <div
          className="fixed z-50 bg-slate-900 text-white p-3 rounded-lg shadow-xl text-xs max-w-xs pointer-events-none"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="font-bold mb-1">{hoveredAsset.asset_name}</div>
          <div className="space-y-0.5 text-slate-300">
            <div>유형: {typeLabels[hoveredAsset.asset_type]}</div>
            <div>제조사: {hoveredAsset.manufacturer} {hoveredAsset.model}</div>
            <div>IP: {hoveredAsset.ip_address || "-"}</div>
            <div>위치: {hoveredAsset.rack_unit_start}U ~ {hoveredAsset.rack_unit_start + hoveredAsset.rack_unit_size - 1}U ({hoveredAsset.rack_unit_size}U)</div>
            <div>상태: {statusLabels[hoveredAsset.status]}</div>
          </div>
        </div>
      )}
    </div>
  );
}

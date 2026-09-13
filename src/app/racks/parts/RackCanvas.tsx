"use client";

import React from "react";
import { History } from "lucide-react";
import { overlaps } from "@/lib/rack-overlap";
import type { Rack, Asset, DistFrame, DragAsset, DropTarget } from "./types";
import {
  spanOf,
  frameOfAsset,
  typeColors,
  typeLabels,
  typeAbbr,
  statusLabels,
  sideLabels,
  previewState,
  getAssetsAt,
  blockAnchorUnit,
} from "./placement";

interface RackCanvasProps {
  filteredRacks: Rack[];
  assets: Asset[];
  distFrames: DistFrame[];
  canWrite: boolean;
  dragAsset: DragAsset | null;
  dropTarget: DropTarget | null;
  hoveredAsset: Asset | null;
  setHoveredAsset: (a: Asset | null) => void;
  hoveredConflict: Asset[] | null;
  setHoveredConflict: (assets: Asset[] | null) => void;
  tooltipPos: { x: number; y: number };
  setTooltipPos: (pos: { x: number; y: number }) => void;
  onSlotDragOver: (e: React.DragEvent, rackId: number, unit: number) => void;
  onSlotDrop: (e: React.DragEvent, rackId: number, totalUnits: number, unit: number) => void;
  onOpenCtxMenu: (e: React.MouseEvent, menuAssets: Asset[]) => void;
  onStartDrag: (e: React.DragEvent, a: Asset) => void;
  onEndDrag: () => void;
  onFetchAuditLogs: (rackId: number, rackName: string) => void;
}

export function RackCanvas({
  filteredRacks,
  assets,
  distFrames,
  canWrite,
  dragAsset,
  dropTarget,
  hoveredAsset,
  setHoveredAsset,
  hoveredConflict,
  setHoveredConflict,
  tooltipPos,
  setTooltipPos,
  onSlotDragOver,
  onSlotDrop,
  onOpenCtxMenu,
  onStartDrag,
  onEndDrag,
  onFetchAuditLogs,
}: RackCanvasProps) {
  return (
    <div className="flex flex-wrap gap-6 relative flex-1">
      {filteredRacks.map((rack) => {
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
        const overflowing = rackAssets.filter(
          (a) => (a.rack_unit_start ?? 1) + a.rack_unit_size - 1 > rack.total_units
        );

        return (
          <div key={rack.id} className="panel p-4 hover-card">
            <div className="text-center mb-3">
              <div className="flex items-center justify-center gap-1">
                <h3 className="font-bold text-sm text-ink">{rack.rack_name}</h3>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onFetchAuditLogs(rack.id, rack.rack_name);
                  }}
                  className="text-ink-3 hover:text-ink hover:bg-slate-100 p-0.5 rounded"
                  title="변경이력"
                >
                  <History size={12} />
                </button>
              </div>
              <p className="text-xs text-ink-3">{rack.location_name}</p>
              <p className="text-[10px] mt-0.5">
                {rack.owner_team_name ? (
                  <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">
                    전용 · {rack.owner_team_name}
                  </span>
                ) : (
                  <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">공유</span>
                )}
              </p>
              <p className="text-xs text-ink-2 mt-1">
                <span className="num">{usedUnits}U</span> / <span className="num">{rack.total_units}U</span> (
                <span className="num">{usagePercent}%</span>)
                {usedUnits > rack.total_units && <span className="text-fault font-bold ml-1">⚠ 초과</span>}
              </p>
            </div>

            {/* 경고 영역 — 심각도: 치명(빨강) > 경고(주황) > 주의(노랑) */}
            {(conflictCount > 0 || overflowing.length > 0 || usagePercent > 100) && (
              <div className="space-y-1 mb-2">
                {conflictCount > 0 && (
                  <div className="text-xs text-fault bg-red-50/10 rounded px-2 py-1">
                    <span className="led led-fault" />
                    <strong>치명</strong> · 슬롯 충돌 장비 <span className="num">{conflictCount}</span>대
                    <a
                      href={`/assets?rack_id=${rack.id}`}
                      className="block text-fault/70 hover:text-fault mt-0.5 underline"
                    >
                      → 자산관리에서 배치 수정
                    </a>
                  </div>
                )}
                {overflowing.length > 0 && (
                  <div className="text-xs text-warning bg-orange-50/10 rounded px-2 py-1">
                    <span className="led led-warn" />
                    <strong>경고</strong> · 범위 초과 <span className="num">{overflowing.length}</span>건
                    <a
                      href={`/assets?rack_id=${rack.id}`}
                      className="block text-warning/70 hover:text-warning mt-0.5 underline"
                    >
                      → 자산관리에서 유닛 위치 확인
                    </a>
                  </div>
                )}
                {usagePercent > 100 && !conflictCount && (
                  <div className="text-xs text-warn bg-amber-50/10 rounded px-2 py-1">
                    <span className="led led-warn" />
                    <strong>주의</strong> · 사용률 <span className="num">{usagePercent}%</span> 초과
                    <span className="block text-ink-3 mt-0.5">→ 랙 증설 또는 장비 재배치를 검토하세요</span>
                  </div>
                )}
              </div>
            )}

            {/* 랙 다이어그램 */}
            <div className="border-2 border-slate-700 rounded bg-slate-800 p-0.5" style={{ width: 220 }}>
              {Array.from({ length: rack.total_units }, (_, i) => {
                const unit = rack.total_units - i; // 상단 42U → 하단 1U (표준 랙 번호)
                const assetsAtUnit = getAssetsAt(rack.id, unit, assets);
                const asset = assetsAtUnit[0] || null;
                // 실제 충돌 여부 — overlaps() 공용 규칙(side 포함): 같은 U라도 L/R 반폭 공존은 충돌 아님
                const hasConflict = assetsAtUnit.some((a, ai) =>
                  assetsAtUnit.some((b, bi) => bi > ai && overlaps(spanOf(a), spanOf(b)))
                );
                const pv = previewState(rack.id, rack.total_units, unit, dragAsset, dropTarget, assets);
                const pvStyle =
                  pv === "ok"
                    ? { boxShadow: "inset 0 0 0 2px #22c55e", backgroundColor: "rgba(34,197,94,0.25)" }
                    : pv === "bad"
                    ? { boxShadow: "inset 0 0 0 2px #ef4444", backgroundColor: "rgba(239,68,68,0.25)" }
                    : {};
                const dndProps = canWrite
                  ? {
                      onDragOver: (e: React.DragEvent) => onSlotDragOver(e, rack.id, unit),
                      onDrop: (e: React.DragEvent) => onSlotDrop(e, rack.id, rack.total_units, unit),
                    }
                  : {};

                if (hasConflict) {
                  // 충돌 시 빨간 점멸 패턴
                  return (
                    <div
                      key={unit}
                      className="flex items-center rounded-sm cursor-pointer relative"
                      style={{
                        height: 24,
                        background:
                          "repeating-linear-gradient(45deg, #ef4444, #ef4444 5px, #fca5a5 5px, #fca5a5 10px)",
                        marginBottom: 1,
                        ...pvStyle,
                      }}
                      {...dndProps}
                      onContextMenu={(e) => onOpenCtxMenu(e, assetsAtUnit)}
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
                      <span className="text-xs text-white font-bold truncate px-1">
                        ⚠ {assetsAtUnit.map((a) => a.asset_name).join(", ")}
                      </span>
                    </div>
                  );
                }

                // 반폭(L/R) 자산 렌더 — 같은 U에 L/R 두 대면 가로 반반, 단독 반폭은 해당 방향 절반 + 반대쪽 빈칸
                const halves = assetsAtUnit.filter((a) => a.rack_side === "L" || a.rack_side === "R");
                if (halves.length > 0) {
                  const leftA = assetsAtUnit.find((a) => a.rack_side === "L") || null;
                  const rightA = assetsAtUnit.find((a) => a.rack_side === "R") || null;
                  const renderHalf = (a: Asset | null) =>
                    a ? (
                      <div
                        draggable={canWrite}
                        onDragStart={(e) => onStartDrag(e, a)}
                        onDragEnd={onEndDrag}
                        onContextMenu={(e) => onOpenCtxMenu(e, [a])}
                        className={`flex items-center rounded-sm hover-rack-item flex-1 min-w-0 ${
                          canWrite ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                        } ${dragAsset?.id === a.id ? "opacity-40" : ""}`}
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
                            <span className="text-white/50 mr-0.5">{typeAbbr[a.asset_type] || "?"}</span>
                            {a.asset_name}
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
                      <span className="num text-[10px] text-slate-500 w-7 text-center shrink-0 self-center">
                        {unit}U
                      </span>
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
                  const startU = asset.rack_unit_start ?? 1;
                  const visibleUnits = unit - Math.max(startU, 1) + 1;
                  const height = visibleUnits * 24;
                  return (
                    <div
                      key={unit}
                      draggable={canWrite}
                      onDragStart={(e) => onStartDrag(e, asset)}
                      onDragEnd={onEndDrag}
                      onContextMenu={(e) => onOpenCtxMenu(e, [asset])}
                      className={`flex items-center rounded-sm hover-rack-item relative ${
                        canWrite ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                      } ${dragAsset?.id === asset.id ? "opacity-40" : ""}`}
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
                      <span className="num text-[10px] text-white/60 w-7 text-center shrink-0">
                        {startU}U
                      </span>
                      <span className="text-xs text-white font-medium truncate px-1">
                        <span className="text-white/50 mr-0.5">{typeAbbr[asset.asset_type] || "?"}</span>
                        {asset.asset_name}
                      </span>
                      {/* FDF 어포던스 (외부 검토 R2-4 합의): 배선반 연결 장비는 선번장 진입 가능함을 블록에서 바로 보이게 */}
                      {frameOfAsset(asset, distFrames) && (
                        <span className="text-[9px] bg-white/25 rounded px-1 ml-1 shrink-0" title="우클릭 → 선번장 열기">
                          선번장
                        </span>
                      )}
                      <span className="num text-[10px] text-white/60 ml-auto pr-1 shrink-0">
                        {asset.rack_unit_size}U
                      </span>
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

      {filteredRacks.length === 0 && <div className="text-ink-3 text-sm p-8">등록된 랙이 없습니다.</div>}

      {/* 툴팁 */}
      {hoveredAsset && (
        <div
          className="fixed z-50 bg-rail text-white p-3 rounded-lg shadow-xl text-xs max-w-xs pointer-events-none"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="font-bold mb-1">{hoveredAsset.asset_name}</div>
          <div className="space-y-0.5 text-white/70">
            <div>유형: {typeLabels[hoveredAsset.asset_type] || hoveredAsset.asset_type}</div>
            <div>
              제조사: {hoveredAsset.manufacturer} {hoveredAsset.model}
            </div>
            <div>
              IP: <span className="num">{hoveredAsset.ip_address || "-"}</span>
            </div>
            <div>
              위치:{" "}
              <span className="num">
                {(hoveredAsset.rack_unit_start ?? 1)}U ~{" "}
                {(hoveredAsset.rack_unit_start ?? 1) + hoveredAsset.rack_unit_size - 1}U (
                {hoveredAsset.rack_unit_size}U)
              </span>
              {hoveredAsset.rack_side ? ` · ${sideLabels[hoveredAsset.rack_side]}` : ""}
            </div>
            <div>상태: {statusLabels[hoveredAsset.status]}</div>
          </div>
          {/* 숨은 상호작용 상시 노출 (외부 검토 R2-2 합의): 우클릭 발견성 */}
          {canWrite && (
            <div className="mt-1.5 pt-1.5 border-t border-white/20 text-white/60">
              드래그: 이동 · 우클릭: 실장 해제{frameOfAsset(hoveredAsset, distFrames) ? " / 선번장 열기" : ""}
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
          <div className="font-bold mb-1 text-red-200">
            ⚠ 충돌 장비 <span className="num">{hoveredConflict.length}</span>대
          </div>
          {hoveredConflict.map((a) => {
            const startU = a.rack_unit_start ?? 1;
            const endU = startU + a.rack_unit_size - 1;
            return (
              <div key={a.id} className="border-t border-red-700 pt-1 mt-1">
                <div className="font-medium">{a.asset_name}</div>
                <div className="text-red-300">
                  {typeLabels[a.asset_type] || a.asset_type} ·{" "}
                  <span className="num">
                    {startU}~{endU}U
                  </span>
                  {a.rack_side ? ` · ${sideLabels[a.rack_side]}` : " · 전폭"} · {statusLabels[a.status]}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

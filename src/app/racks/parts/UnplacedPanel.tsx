"use client";

import type { Asset, DragAsset } from "./types";
import { typeColors, typeLabels } from "./placement";

interface UnplacedPanelProps {
  unplacedAssets: Asset[];
  dragAsset: DragAsset | null;
  unplacedSearch: string;
  setUnplacedSearch: (val: string) => void;
  unplacedType: string;
  setUnplacedType: (val: string) => void;
  onStartDrag: (e: React.DragEvent, a: Asset) => void;
  onEndDrag: () => void;
  onPlaceAsset: (rackId: number | null, unitStart: number | null) => void;
}

export function UnplacedPanel({
  unplacedAssets,
  dragAsset,
  unplacedSearch,
  setUnplacedSearch,
  unplacedType,
  setUnplacedType,
  onStartDrag,
  onEndDrag,
  onPlaceAsset,
}: UnplacedPanelProps) {
  return (
    <div
      className={`panel p-3 w-56 shrink-0 ${dragAsset && dragAsset.fromRackId ? "ring-2 ring-signal" : ""}`}
      onDragOver={(e) => {
        if (dragAsset && dragAsset.fromRackId) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (dragAsset && dragAsset.fromRackId) onPlaceAsset(null, null);
      }}
    >
      <h4 className="font-medium text-sm mb-1">
        미배치 자산 <span className="num text-ink-3">{unplacedAssets.length}</span>
      </h4>
      <p className="text-[11px] text-ink-3 mb-2">
        자산을 끌어 랙 슬롯에 놓으면 배치됩니다. 실장된 장비를 이 패널에 놓으면 해제됩니다.
      </p>
      <div className="flex gap-1 mb-2">
        <input
          value={unplacedSearch}
          onChange={(e) => setUnplacedSearch(e.target.value)}
          placeholder="자산 검색..."
          className="form-input text-xs flex-1 min-w-0"
        />
        <select
          value={unplacedType}
          onChange={(e) => setUnplacedType(e.target.value)}
          className="form-input text-xs shrink-0"
          style={{ width: 88 }}
          title="유형 필터"
        >
          <option value="">전체</option>
          {Object.entries(typeLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1 max-h-[65vh] overflow-y-auto">
        {unplacedAssets
          .filter((a) => !unplacedType || a.asset_type === unplacedType)
          .filter(
            (a) =>
              !unplacedSearch ||
              `${a.asset_name} ${a.model} ${a.manufacturer}`.toLowerCase().includes(unplacedSearch.toLowerCase())
          )
          .map((a) => (
            <div
              key={a.id}
              draggable
              onDragStart={(e) => onStartDrag(e, a)}
              onDragEnd={onEndDrag}
              className={`px-2 py-1.5 rounded bg-surface border border-line text-xs cursor-grab active:cursor-grabbing hover:bg-slate-100 ${
                dragAsset?.id === a.id ? "opacity-40" : ""
              }`}
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
  );
}

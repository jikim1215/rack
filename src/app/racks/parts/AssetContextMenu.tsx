"use client";

import { useRouter } from "next/navigation";
import type { CtxMenuState, DistFrame, Asset } from "./types";
import { frameOfAsset } from "./placement";

interface AssetContextMenuProps {
  ctxMenu: CtxMenuState;
  onClose: () => void;
  distFrames: DistFrame[];
  onUnrack: (a: Asset) => void;
}

export function AssetContextMenu({ ctxMenu, onClose, distFrames, onUnrack }: AssetContextMenuProps) {
  const router = useRouter();

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 bg-panel border border-line rounded-lg shadow-xl py-1 min-w-48 text-sm"
        style={{
          left: Math.min(ctxMenu.x, typeof window !== "undefined" ? window.innerWidth - 220 : ctxMenu.x),
          top: ctxMenu.y,
        }}
      >
        {ctxMenu.assets.map((a) => {
          const frame = frameOfAsset(a, distFrames);
          const startU = a.rack_unit_start ?? 1;
          const endU = startU + Math.max(1, a.rack_unit_size || 1) - 1;
          return (
            <div key={a.id} className={ctxMenu.assets.length > 1 ? "border-b border-line last:border-b-0" : ""}>
              <div className="px-3 pt-1.5 pb-0.5 text-xs text-ink-3 truncate flex justify-between gap-2">
                <span className="truncate">{a.asset_name || a.model || "(이름없음)"}</span>
                <span className="num shrink-0">
                  {startU}~{endU}U
                </span>
              </div>
              <button
                onClick={() => {
                  onClose();
                  router.push(`/assets?q=${encodeURIComponent(a.asset_name || a.model || "")}`);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-surface text-ink-2 hover:text-ink"
              >
                자산관리에서 열기
              </button>
              {frame && (
                <button
                  onClick={() => {
                    onClose();
                    router.push(`/distribution?frame=${frame.id}`);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-surface text-signal"
                >
                  선번장 열기 (배선현황)
                </button>
              )}
              <button onClick={() => onUnrack(a)} className="w-full text-left px-3 py-1.5 hover:bg-surface text-fault">
                실장 해제
              </button>
            </div>
          );
        })}
        <div className="border-t border-line mt-1 pt-1">
          <button onClick={onClose} className="w-full text-left px-3 py-1.5 text-ink-3 hover:bg-surface">
            닫기
          </button>
        </div>
      </div>
    </>
  );
}

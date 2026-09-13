"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import type { Asset, DragAsset, DropTarget, CtxMenuState } from "./types";
import { canDropAt } from "./placement";

export function useRackPlacement(assets: Asset[], canWrite: boolean) {
  const router = useRouter();
  const { addToast } = useToast();
  const [dragAsset, setDragAsset] = useState<DragAsset | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);

  function openCtxMenu(e: React.MouseEvent, menuAssets: Asset[]) {
    if (!canWrite || menuAssets.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, assets: menuAssets });
  }

  function startDrag(e: React.DragEvent, a: Asset) {
    e.dataTransfer.setData("text/plain", String(a.id));
    e.dataTransfer.effectAllowed = "move";
    setDragAsset({
      id: a.id,
      name: a.asset_name,
      size: Math.max(1, a.rack_unit_size || 1),
      fromRackId: a.rack_id ?? null,
      fromUnitStart: a.rack_unit_start ?? null,
      side: a.rack_side ?? null,
    });
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
      const undoAction = opts.undoable
        ? {
            label: "실행 취소",
            onClick: () =>
              updatePlacement(
                { ...target, prevRackId: rackId, prevUnitStart: unitStart },
                target.prevRackId,
                target.prevUnitStart,
                { undoable: false }
              ),
          }
        : undefined;
      if (rackId) {
        addToast(`'${target.name}' 배치 완료 (${unitStart}U~${unitStart! + target.size - 1}U)`, "success", undoAction);
        if (!(data.ip_address || "").trim()) {
          addToast(`'${target.name}'은(는) 아직 IP가 없습니다.`, "info", {
            label: "자산관리에서 IP 부여",
            href: "/assets?missing=ip",
          });
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
      rackId,
      unitStart,
      { undoable: true }
    );
  }

  function slotDrop(e: React.DragEvent, rackId: number, totalUnits: number, unit: number) {
    e.preventDefault();
    if (!dragAsset) return;
    if (canDropAt(rackId, totalUnits, unit, dragAsset, assets)) {
      placeAsset(rackId, unit);
    } else {
      addToast("해당 위치에 배치할 수 없습니다 (충돌 또는 범위 초과).", "error");
      endDrag();
    }
  }

  function unrackFromMenu(a: Asset) {
    setCtxMenu(null);
    updatePlacement(
      {
        id: a.id,
        name: a.asset_name || "(이름없음)",
        size: Math.max(1, a.rack_unit_size || 1),
        prevRackId: a.rack_id ?? null,
        prevUnitStart: a.rack_unit_start ?? null,
      },
      null,
      null,
      { undoable: true }
    );
  }

  return {
    dragAsset,
    dropTarget,
    ctxMenu,
    setCtxMenu,
    openCtxMenu,
    startDrag,
    endDrag,
    slotDragOver,
    slotDrop,
    placeAsset,
    unrackFromMenu,
  };
}

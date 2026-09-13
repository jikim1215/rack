import { overlaps, type RackSpan } from "@/lib/rack-overlap";
import type { Asset, DistFrame, DragAsset, DropTarget, Severity } from "./types";

export const typeColors: Record<string, string> = {
  server: "#334155",
  network: "#16a34a",
  security: "#dc2626",
  telecom: "#d97706",
  other: "#6b7280",
};

export const typeLabels: Record<string, string> = {
  server: "서버",
  network: "네트워크",
  security: "정보보호",
  telecom: "전화설비",
  other: "기타",
};

export const statusLabels: Record<string, string> = {
  active: "운용중",
  maintenance: "점검중",
  standby: "예비",
  retired: "폐기",
};

export const typeAbbr: Record<string, string> = {
  server: "S",
  network: "N",
  security: "F",
  telecom: "T",
  other: "E",
};

export const sideLabels: Record<string, string> = {
  L: "좌 반폭",
  R: "우 반폭",
};

// 자산 → 겹침 판정용 구간(RackSpan) 변환 (rack-overlap.ts 공용 규칙 사용)
export function spanOf(a: Asset): RackSpan {
  return {
    start: a.rack_unit_start ?? 1,
    size: Math.max(1, a.rack_unit_size || 1),
    side: a.rack_side ?? null,
  };
}

// 자산의 실장 구간과 겹치는 선번장(dist_frame) 찾기 — FDF 우클릭 → 선번장 바로가기
export function frameOfAsset(a: Asset, distFrames: DistFrame[]): DistFrame | null {
  if (a.rack_id == null || a.rack_unit_start == null) return null;
  const aStart = a.rack_unit_start; // 클로저 안에서도 non-null 이 유지되도록 지역변수로
  const aEnd = aStart + Math.max(1, a.rack_unit_size || 1) - 1;
  return (
    distFrames.find((f) => {
      if (f.rack_id !== a.rack_id || f.rack_unit_start == null) return false;
      const fEnd = f.rack_unit_start + Math.max(1, f.rack_unit_size || 1) - 1;
      return f.rack_unit_start <= aEnd && fEnd >= aStart;
    }) || null
  );
}

// 랙별 경고 심각도 판정: critical(충돌) > warning(범위초과) > caution(사용률초과)
export function getRackSeverity(rackId: number, totalUnits: number, assets: Asset[]): Severity {
  const ra = assets.filter((a) => a.rack_id === rackId && a.rack_unit_start != null);
  // 충돌 검사 → 치명 (side 규칙 포함: L/R 반폭은 공존 허용)
  for (let i = 0; i < ra.length; i++) {
    for (let j = i + 1; j < ra.length; j++) {
      if (overlaps(spanOf(ra[i]), spanOf(ra[j]))) return "critical";
    }
  }
  // 범위 초과 → 경고
  if (ra.some((a) => (a.rack_unit_start ?? 1) + a.rack_unit_size - 1 > totalUnits)) return "warning";
  // 사용률 초과 → 주의
  const used = ra.reduce((s, a) => s + a.rack_unit_size, 0);
  if (used > totalUnits) return "caution";
  return null;
}

export function hasWarning(rackId: number, totalUnits: number, assets: Asset[]): boolean {
  return getRackSeverity(rackId, totalUnits, assets) !== null;
}

export function canDropAt(
  rackId: number,
  totalUnits: number,
  unit: number,
  dragAsset: DragAsset | null,
  assets: Asset[]
): boolean {
  if (!dragAsset) return false;
  const end = unit + dragAsset.size - 1;
  if (end > totalUnits) return false;
  // 겹침 판정은 rack-overlap.ts 공용 규칙(side 포함) 사용 — 서버 SQL과 동일
  const span: RackSpan = { start: unit, size: dragAsset.size, side: dragAsset.side };
  return !assets.some(
    (a) => a.rack_id === rackId && a.id !== dragAsset.id && a.rack_unit_start != null && overlaps(span, spanOf(a))
  );
}

// 미리보기: 드롭 대상 범위에 포함된 유닛이면 유효/무효 상태 반환
export function previewState(
  rackId: number,
  totalUnits: number,
  unit: number,
  dragAsset: DragAsset | null,
  dropTarget: DropTarget | null,
  assets: Asset[]
): "ok" | "bad" | null {
  if (!dragAsset || !dropTarget || dropTarget.rackId !== rackId) return null;
  if (unit < dropTarget.unit || unit > dropTarget.unit + dragAsset.size - 1) return null;
  return canDropAt(rackId, totalUnits, dropTarget.unit, dragAsset, assets) ? "ok" : "bad";
}

export function getAssetsAt(rackId: number, unit: number, assets: Asset[]): Asset[] {
  return assets.filter(
    (a) => a.rack_id === rackId && a.rack_unit_start != null && a.rack_unit_start <= unit && a.rack_unit_start + a.rack_unit_size - 1 >= unit
  );
}

// 표준 랙 번호 규격: 하단이 1U, 상단이 total_units(예: 42U). 다이어그램은 위에서 아래로 내림차순 렌더.
// 멀티U 장비의 "시각적 앵커"(블록을 그리는 행)는 장비의 최상단 유닛 = start + size - 1 (랙 상한 클램프).
export function blockAnchorUnit(asset: Asset, totalUnits: number): number {
  return Math.min((asset.rack_unit_start ?? 1) + asset.rack_unit_size - 1, totalUnits);
}

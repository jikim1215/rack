/**
 * 랙 슬롯 겹침 판정 공용 모듈.
 *
 * 규칙(서버 SQL과 동일 — rack-validation.ts의 겹침 쿼리 참조):
 *  1) U 구간 겹침: a.start <= b.end AND b.start <= a.end (end = start + size - 1)
 *  2) 반폭(side) 규칙: 한쪽이라도 side가 null/undefined(전폭)이면 충돌,
 *     둘 다 반폭이면 같은 방향(L=L, R=R)일 때만 충돌. L/R은 공존 가능.
 */
export interface RackSpan {
  start: number;
  size: number;
  side?: "L" | "R" | null;
}

/** 두 랙 배치 구간이 물리적으로 충돌하는지 판정한다. */
export function overlaps(a: RackSpan, b: RackSpan): boolean {
  const aEnd = a.start + a.size - 1;
  const bEnd = b.start + b.size - 1;
  // U 구간이 겹치지 않으면 충돌 없음
  if (!(a.start <= bEnd && b.start <= aEnd)) return false;
  // side 규칙: null/undefined = 전폭(모두와 충돌), 반폭끼리는 같은 방향만 충돌
  const aSide = a.side ?? null;
  const bSide = b.side ?? null;
  return aSide == null || bSide == null || aSide === bSide;
}

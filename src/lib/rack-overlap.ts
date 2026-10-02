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

/** 충돌 탐지 입력 한 줄 — 같은 랙 안의 배치. inScope: 이 자산이 조회자 범위인지(쌍 중 하나라도 범위면 노출). */
export interface RackPlacement extends RackSpan {
  rackId: number;
  rackName: string;
  id: number;
  name: string;
  inScope: boolean;
}

export interface RackConflict {
  rackName: string;
  ovStart: number;
  ovEnd: number;
  aName: string;
  bName: string;
}

/**
 * 랙 실장 충돌 쌍 — 랙 이름·겹침 시작 U 순으로 최대 limit 개.
 * 랙마다 시작 U 로 정렬해 쓸어 가며, 아직 끝나지 않은 배치(active)하고만 overlaps() 로 비교한다.
 * SQL 자기조인(같은 랙 모든 쌍)은 한 랙에 자산이 몰리면 쌍이 제곱으로 늘어(1만 건 시험 DB 에서 200만 쌍·1.1초)
 * 대시보드가 느려졌다. 규칙은 overlaps() 하나 — 화면 배치 검사·서버 저장 검사와 같은 판정.
 */
export function findRackConflicts(rows: RackPlacement[], limit = 20): RackConflict[] {
  const byRack = new Map<number, RackPlacement[]>();
  for (const r of rows) {
    const list = byRack.get(r.rackId);
    if (list) list.push(r); else byRack.set(r.rackId, [r]);
  }
  const racks = [...byRack.values()].sort((x, y) => (x[0].rackName < y[0].rackName ? -1 : x[0].rackName > y[0].rackName ? 1 : x[0].rackId - y[0].rackId));
  // 시작 U 순으로 쓸면 쌍의 겹침 시작 = 나중 배치의 시작이라 결과가 이미 (랙, 겹침 시작) 순으로 나온다 → limit 에서 바로 멈춘다.
  const out: RackConflict[] = [];
  for (const list of racks) {
    list.sort((x, y) => x.start - y.start || x.id - y.id);
    let active: RackPlacement[] = [];
    for (const b of list) {
      active = active.filter((a) => a.start + a.size - 1 >= b.start);
      for (const a of active) {
        if (!(a.inScope || b.inScope) || !overlaps(a, b)) continue;
        const [first, second] = a.id < b.id ? [a, b] : [b, a];
        out.push({
          rackName: b.rackName,
          ovStart: b.start,
          ovEnd: Math.min(a.start + a.size - 1, b.start + b.size - 1),
          aName: first.name,
          bName: second.name,
        });
        if (out.length >= limit) return out;
      }
      active.push(b);
    }
  }
  return out;
}

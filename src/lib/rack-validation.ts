import type Database from "better-sqlite3";

/**
 * 랙 슬롯 배치 유효성 검증
 * @returns null이면 유효, 문자열이면 오류 메시지
 */
export function validateRackPlacement(
  db: Database.Database,
  rackId: number | null,
  unitStart: number | null,
  unitSize: number,
  excludeAssetId?: number, // PUT 시 자기 자신 제외
  rackSide?: "L" | "R" | null // 반폭 배치: L/R, null/undefined = 전폭
): string | null {
  if (!rackId) return null; // 미설치는 OK

  // 랙 존재 확인
  const rack = db.prepare("SELECT id, total_units FROM racks WHERE id = ?").get(rackId) as any;
  if (!rack) return `랙(ID: ${rackId})이 존재하지 않습니다.`;

  // rack_unit_start 필수
  if (!unitStart || unitStart < 1) {
    return "시작 U는 1 이상이어야 합니다.";
  }

  // unitSize 양수
  if (unitSize < 1) {
    return "크기(U)는 1 이상이어야 합니다.";
  }

  // 범위 초과 검사
  const endUnit = unitStart + unitSize - 1;
  if (endUnit > rack.total_units) {
    return `배치 범위(${unitStart}~${endUnit}U)가 랙 용량(${rack.total_units}U)을 초과합니다.`;
  }

  // 중복 배치 검사 (구간 겹침: 기존.start <= new.end AND 기존.end >= new.start)
  // side 규칙은 src/lib/rack-overlap.ts의 overlaps()와 동일해야 한다:
  //   (기존.rack_side IS NULL OR 신규.side IS NULL OR 기존.rack_side = 신규.side)
  //   → 전폭(null)은 모두와 충돌, 반폭(L/R)끼리는 같은 방향만 충돌.
  const side = rackSide ?? null;
  // 기존 이상치 행 방어(비평 합의 R2-2): rack_unit_start NULL·size<1 행은 겹침 식이 NULL/비정상이 되므로 명시 제외
  const overlapQuery = excludeAssetId
    ? `SELECT id, asset_name, rack_unit_start, rack_unit_size FROM assets 
       WHERE rack_id = ? AND id != ? AND rack_unit_start IS NOT NULL AND rack_unit_size >= 1
       AND rack_unit_start <= ? AND (rack_unit_start + rack_unit_size - 1) >= ?
       AND (rack_side IS NULL OR ? IS NULL OR rack_side = ?)`
    : `SELECT id, asset_name, rack_unit_start, rack_unit_size FROM assets 
       WHERE rack_id = ? AND rack_unit_start IS NOT NULL AND rack_unit_size >= 1
       AND rack_unit_start <= ? AND (rack_unit_start + rack_unit_size - 1) >= ?
       AND (rack_side IS NULL OR ? IS NULL OR rack_side = ?)`;

  const params = excludeAssetId
    ? [rackId, excludeAssetId, endUnit, unitStart, side, side]
    : [rackId, endUnit, unitStart, side, side];

  const overlapping = db.prepare(overlapQuery).all(...params) as any[];

  if (overlapping.length > 0) {
    // 타팀 자산명 노출 방지(AC-8): 공유 랙의 물리 U-구간만 표기, 자산명은 비노출
    const ranges = overlapping.map((a: any) => `${a.rack_unit_start}~${a.rack_unit_start + a.rack_unit_size - 1}U`).join(", ");
    return `슬롯 충돌: 이미 사용 중인 구간(${ranges})과 배치가 겹칩니다.`;
  }

  return null;
}

/**
 * 랙 total_units 축소 시 기존 자산 범위 검증
 */
export function validateRackResize(
  db: Database.Database,
  rackId: number,
  newTotalUnits: number
): string | null {
  if (newTotalUnits < 1) return "총 유닛 수는 1 이상이어야 합니다.";

  const maxUsed = db.prepare(
    "SELECT MAX(rack_unit_start + rack_unit_size - 1) as max_end FROM assets WHERE rack_id = ?"
  ).get(rackId) as any;

  if (maxUsed?.max_end && maxUsed.max_end > newTotalUnits) {
    return `현재 ${maxUsed.max_end}U까지 장비가 배치되어 있어 ${newTotalUnits}U로 축소할 수 없습니다.`;
  }

  return null;
}

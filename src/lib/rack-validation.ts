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
  excludeAssetId?: number // PUT 시 자기 자신 제외
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
  const overlapQuery = excludeAssetId
    ? `SELECT id, asset_name, rack_unit_start, rack_unit_size FROM assets 
       WHERE rack_id = ? AND id != ? 
       AND rack_unit_start <= ? AND (rack_unit_start + rack_unit_size - 1) >= ?`
    : `SELECT id, asset_name, rack_unit_start, rack_unit_size FROM assets 
       WHERE rack_id = ? 
       AND rack_unit_start <= ? AND (rack_unit_start + rack_unit_size - 1) >= ?`;

  const params = excludeAssetId
    ? [rackId, excludeAssetId, endUnit, unitStart]
    : [rackId, endUnit, unitStart];

  const overlapping = db.prepare(overlapQuery).all(...params) as any[];

  if (overlapping.length > 0) {
    const names = overlapping.map((a: any) => `${a.asset_name}(${a.rack_unit_start}~${a.rack_unit_start + a.rack_unit_size - 1}U)`).join(", ");
    return `슬롯 충돌: ${names}와 배치가 겹칩니다.`;
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

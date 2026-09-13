export const FRESH_DAYS = 90;
export const STALE_DAYS = 180;

export type FreshnessStatus = "fresh" | "aging" | "stale" | "never";

/**
 * 자산 현행화 상태 판정
 * @param verifiedAt 현행 확인 일시 (ISO, YYYY-MM-DD HH:mm:ss 등)
 * @param now 기준 시각 (기본값: 현재 시각)
 */
export function freshnessOf(verifiedAt?: string | null, now: Date = new Date()): FreshnessStatus {
  if (!verifiedAt || verifiedAt.trim() === "") {
    return "never";
  }
  const dateStr = verifiedAt.includes(" ") ? verifiedAt.replace(" ", "T") : verifiedAt;
  const vDate = new Date(dateStr);
  if (isNaN(vDate.getTime())) {
    return "never";
  }
  const diffMs = now.getTime() - vDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays <= FRESH_DAYS) {
    return "fresh";
  }
  if (diffDays <= STALE_DAYS) {
    return "aging";
  }
  return "stale";
}

/**
 * 현행화 상태 또는 확인일시에 따른 한국어 라벨 반환
 */
export function freshnessLabel(statusOrVerifiedAt?: FreshnessStatus | string | null): string {
  if (!statusOrVerifiedAt) {
    return "확인 이력 없음";
  }
  let status: FreshnessStatus;
  if (
    statusOrVerifiedAt === "fresh" ||
    statusOrVerifiedAt === "aging" ||
    statusOrVerifiedAt === "stale" ||
    statusOrVerifiedAt === "never"
  ) {
    status = statusOrVerifiedAt;
  } else {
    status = freshnessOf(statusOrVerifiedAt);
  }

  switch (status) {
    case "fresh":
      return "90일 내 확인";
    case "aging":
      return "확인 후 90일 경과";
    case "stale":
      return "180일 이상 미확인";
    case "never":
    default:
      return "확인 이력 없음";
  }
}

/**
 * SQL 표현식 생성기 (SQLite 버킷 집계용 CASE 문)
 * @param col 자산 verified_at 컬럼명 (기본값: 'a.verified_at')
 */
export function freshnessCaseSql(col: string = "a.verified_at"): string {
  return `CASE
    WHEN ${col} IS NULL OR ${col} = '' THEN 'never'
    WHEN (julianday('now', 'localtime') - julianday(${col})) <= 90 THEN 'fresh'
    WHEN (julianday('now', 'localtime') - julianday(${col})) <= 180 THEN 'aging'
    ELSE 'stale'
  END`;
}

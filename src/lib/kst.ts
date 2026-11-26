// KST(UTC+9) 달력 날짜 — 서버/브라우저 TZ 와 무관. toISOString().slice(0,10) 은 UTC 날짜라
// KST 00:00~08:59 에 하루 전 날짜가 나온다(폐쇄망 서버 TZ 가 UTC 일 수도 있어 로컬 TZ 에도 기대지 않는다).
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** "YYYY-MM-DD" (KST). offsetDays 로 N일 뒤/앞 날짜. */
export function kstDate(now: Date = new Date(), offsetDays = 0): string {
  return new Date(now.getTime() + KST_OFFSET_MS + offsetDays * 86400000).toISOString().slice(0, 10);
}

// 앱 버전 표기 헬퍼 — 순수 함수(서버·클라이언트 공용). 값 자체(APP_BUILD)는 서버 전용 lib/app-build.ts 에 있다.
// 정본 계산: scripts/build-meta.mjs → next.config.ts env → app-build.ts.
export type AppBuild = { version: string; commit: string; builtAt: string };

/**
 * 화면 표기: "v1.1.0", 커밋 포함 시 "v1.1.0 · e2999fd". 버전 정보는 로그인 후 사이드바에만 보인다(로그인 화면 미표기).
 */
export function buildLabel(b: AppBuild, opts: { withCommit?: boolean } = {}): string {
  if (!b.version) return "";
  return opts.withCommit && b.commit ? `v${b.version} · ${b.commit}` : `v${b.version}`;
}

/** ISO 시각 → "YYYY-MM-DD HH:mm (KST)" — 서버/브라우저 TZ 와 무관(폐쇄망 서버 TZ 가 UTC 여도 같은 표기). */
export function kstMinute(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const k = new Date(t + 9 * 60 * 60 * 1000).toISOString();
  return `${k.slice(0, 10)} ${k.slice(11, 16)} (KST)`;
}

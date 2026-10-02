// 앱 버전 표시 — 값은 빌드 때 next.config.ts 의 env 가 박아 넣는다(정본 계산: scripts/build-meta.mjs).
// 서버·클라이언트 어디서 import 해도 같은 상수다(하이드레이션 불일치 없음). 테스트·tsc 처럼 next 빌드 밖이면 빈 값.
export type AppBuild = { version: string; commit: string; builtAt: string };

export const APP_BUILD: AppBuild = {
  version: process.env.APP_VERSION ?? "",
  commit: process.env.APP_COMMIT ?? "",
  builtAt: process.env.APP_BUILT_AT ?? "",
};

/**
 * 화면 표기. 로그인 전에는 버전만("v1.1.0"), 로그인 후에는 커밋까지("v1.1.0 · e2999fd").
 * 커밋은 같은 버전 번호로 다시 빌드한 판을 구별하는 값이라 로그인 사용자에게만 보인다.
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

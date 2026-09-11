// ── 빌드 산출물 가드 (P4 CSP nonce) ──
// nonce 기반 CSP 는 정적 프리렌더 페이지와 양립하지 않는다(빌드 시점 HTML 에는 요청별 nonce 가 없어 'strict-dynamic' 이
// 스크립트를 전부 차단 → 과거 /change-password 가 그렇게 잠겼다). `next build` 후 .next/prerender-manifest.json 을 읽어
// 페이지 라우트가 하나도 정적으로 프리렌더되지 않았는지 확인한다. 사용: npm run build && node scripts/verify-build.mjs
import { readFileSync, existsSync } from "node:fs";

const manifestPath = ".next/prerender-manifest.json";
if (!existsSync(manifestPath)) {
  console.error(`✗ ${manifestPath} 없음 — 먼저 next build 를 실행하세요.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const routes = Object.keys(manifest.routes || {});
// 페이지 HTML 라우트만 대상 (파비콘 등 정적 파일 라우트는 제외)
const staticPages = routes.filter((r) => !/\.(ico|png|svg|txt|xml|json|webmanifest)$/.test(r));
if (staticPages.length > 0) {
  console.error(`✗ 정적 프리렌더된 페이지 ${staticPages.length}건 — nonce CSP 에서 스크립트가 차단됩니다: ${staticPages.join(", ")}`);
  console.error("  루트 layout 이 headers() 를 읽어 전체를 동적 렌더로 만들어야 합니다 (src/app/layout.tsx).");
  process.exit(1);
}
console.log(`✓ 정적 프리렌더 페이지 0건 (검사한 라우트 ${routes.length}개) — nonce CSP 와 양립`);

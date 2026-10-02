import type { NextConfig } from "next";
import { resolveBuildMeta } from "./scripts/build-meta.mjs";

// 버전·커밋·빌드 시각을 빌드에 박는다(화면 하단 표기·/api/health·번들 VERSION 이 같은 값).
// next build 는 설정을 여러 워커에서 다시 읽는다 — 처음 계산한 값을 env 에 고정해 워커가 그대로 물려받게 한다.
const build = resolveBuildMeta({ root: process.cwd() });
process.env.APP_COMMIT ??= build.commit;
process.env.APP_BUILT_AT ??= build.builtAt;

// 폐쇄망 보안 헤더 (모든 응답에 적용).
// Content-Security-Policy 는 요청별 nonce 가 필요해 src/middleware.ts 에서 붙인다(script-src 'unsafe-inline' 제거, P4).
// 여기는 nonce 가 필요 없는 고정 헤더만 둔다.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "xlsx", "nodemailer"],
  // 폐쇄망: 외부 요청 차단
  images: { unoptimized: true },
  // Next 15.5 는 sharp(이미지 최적화, @img/* 네이티브 ~18MB)를 standalone 에 트레이스한다.
  // 이미지 최적화는 위에서 끔으므로 런타임에 로드되지 않는다 — 폐쇄망 번들에서 제외.
  outputFileTracingExcludes: { "*": ["node_modules/sharp/**", "node_modules/@img/**"] },
  // Next 15.5+: 미들웨어를 거치는 요청 본문은 기본 10MB 에서 잘린다 → 엑셀 업로드 상한(UPLOAD_MAX_BYTES=20MB)이
  // 무력화되고 10~20MB 파일이 500 으로 깨진다. 상한 + multipart 오버헤드 여유로 올린다(nginx client_max_body_size 이하).
  experimental: { middlewareClientMaxBodySize: "25mb" },
  typescript: { ignoreBuildErrors: false },
  // src/lib/app-version.ts 가 읽는다 (서버·클라이언트 번들 모두 상수로 치환)
  env: { APP_VERSION: build.version, APP_COMMIT: build.commit, APP_BUILT_AT: build.builtAt },
  // 서버 기술 노출 방지 (X-Powered-By 제거)
  poweredByHeader: false,
  // 텔레메트리 비활성화는 .env에서 NEXT_TELEMETRY_DISABLED=1 로 처리
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

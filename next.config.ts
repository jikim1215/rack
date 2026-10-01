import type { NextConfig } from "next";

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
  // Next 15.5+: 미들웨어를 거치는 요청 본문은 기본 10MB 에서 잘린다 → 엑셀 업로드 상한(UPLOAD_MAX_BYTES=20MB)이
  // 무력화되고 10~20MB 파일이 500 으로 깨진다. 상한 + multipart 오버헤드 여유로 올린다(nginx client_max_body_size 이하).
  experimental: { middlewareClientMaxBodySize: "25mb" },
  typescript: { ignoreBuildErrors: false },
  // 서버 기술 노출 방지 (X-Powered-By 제거)
  poweredByHeader: false,
  // 텔레메트리 비활성화는 .env에서 NEXT_TELEMETRY_DISABLED=1 로 처리
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

// 폐쇄망 보안 헤더 (모든 응답에 적용). default-src 'self' 로 외부 리소스/연결을 차단해
// "외부 CDN/폰트/API/텔레메트리 0" 원칙을 브라우저 단에서도 강제한다.
// 주: Next 하이드레이션 인라인 스크립트/Tailwind 인라인 스타일 때문에 script/style 에 'unsafe-inline'
// (dev HMR 은 'unsafe-eval')을 허용한다. 외부 출처 차단·클릭재킹 방지가 1차 목표이며,
// 추후 nonce 기반으로 'unsafe-inline' 제거 권장.
const isDev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "manifest-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
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
  typescript: { ignoreBuildErrors: false },
  // 서버 기술 노출 방지 (X-Powered-By 제거)
  poweredByHeader: false,
  // 텔레메트리 비활성화는 .env에서 NEXT_TELEMETRY_DISABLED=1 로 처리
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

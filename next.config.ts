import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "xlsx"],
  // 폐쇄망: 외부 요청 차단
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // 텔레메트리 비활성화는 .env에서 NEXT_TELEMETRY_DISABLED=1 로 처리
};

export default nextConfig;

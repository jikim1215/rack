import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { LayoutShell } from "@/components/LayoutShell";

export const metadata: Metadata = {
  title: "정보시스템 자산관리",
  description: "서버/네트워크/보안 장비 자산관리 및 랙실장도, 포트맵 관리 시스템",
};

// 브라우저/OS 다크테마와 무관하게 라이트로 렌더 (<meta name="color-scheme" content="light">).
export const viewport: Viewport = {
  colorScheme: "light",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // nonce 기반 CSP(ADR-016): 요청 헤더를 읽으면 루트 아래 모든 라우트가 동적 렌더가 된다.
  // 정적 프리렌더 페이지(과거 /change-password, /_not-found)는 빌드 시점 HTML 이라 요청별 nonce 를 받을 수 없어
  // 운영 CSP('strict-dynamic')가 스크립트를 전부 차단했다 — 비밀번호 강제변경 사용자가 잠기는 결함(비평 반영).
  // 여기서 한 번 읽어 두면 어떤 페이지도 실수로 정적이 될 수 없다.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="ko" data-csp-nonce={nonce ? "1" : "0"}>
      <body>
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}

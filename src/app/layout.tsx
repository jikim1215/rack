import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}

"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Onboarding } from "./Onboarding";
import { ToastProvider } from "./Toast";
import { SessionExpiryBanner } from "./SessionExpiryBanner";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // 로그인·비밀번호 강제변경 화면은 사이드바 없는 단독 레이아웃.
  const isBare = pathname === "/login" || pathname === "/change-password";

  if (isBare) {
    return <>{children}</>;
  }

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <SessionExpiryBanner />
          <main data-onboard="main" className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
      <Onboarding />
    </ToastProvider>
  );
}

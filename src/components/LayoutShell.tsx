"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Onboarding } from "./Onboarding";
import { ToastProvider } from "./Toast";
import { SessionExpiryBanner } from "./SessionExpiryBanner";
import { FeedbackModal } from "./FeedbackModal";
import { useDialog } from "@/lib/use-dialog";

/** 좁은 화면(< lg)에서 사이드바 서랍을 여는 이벤트 — 온보딩 투어가 메뉴를 가리킬 때 사용(Onboarding.tsx). */
const NAV_OPEN_EVENT = "asset:nav-open";

/** lg(1024px) 미만 여부 — 서랍 모드. SSR·첫 렌더는 false(넓은 화면 가정)로 두고 마운트 후 실제 값으로 맞춘다. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023.98px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return narrow;
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // 좁은 화면 전용 서랍 상태. lg 이상에서는 사이드바가 항상 보이고 이 값은 무시된다.
  // "user" = 햄버거로 연 서랍(모달: 초점 가두기·Esc·초점 복귀), "tour" = 온보딩이 메뉴를 가리키려 연 서랍(투어 말풍선이
  // 서랍 밖에 있으므로 가두지 않는다 — Esc 는 동일하게 닫음).
  const [navOpen, setNavOpen] = useState<false | "user" | "tour">(false);
  const narrow = useNarrow();

  // 메뉴로 이동하면 서랍을 닫고, 초점은 햄버거가 아니라 새 화면 본문으로(스크린리더가 바뀐 화면부터 읽도록).
  // navigatedRef = "서랍이 열린 채로 화면이 바뀌었다" — 다음 서랍 닫힘의 초점 복귀 대상을 본문으로 바꾼다.
  const navigatedRef = useRef(false);
  const navOpenRef = useRef(navOpen);
  navOpenRef.current = navOpen;
  useEffect(() => {
    navigatedRef.current = navOpenRef.current !== false;
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const open = () => setNavOpen((v) => v || "tour");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpen(false); };
    window.addEventListener(NAV_OPEN_EVENT, open);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener(NAV_OPEN_EVENT, open); window.removeEventListener("keydown", onKey); };
  }, []);
  const drawerRef = useDialog(narrow && navOpen === "user", () => setNavOpen(false), {
    returnFocus: () => {
      if (!navigatedRef.current) return null;
      navigatedRef.current = false;
      return document.getElementById("main-content");
    },
  });

  // 로그인·비밀번호 강제변경 화면은 사이드바 없는 단독 레이아웃.
  const isBare = pathname === "/login" || pathname === "/change-password";

  if (isBare) {
    return <>{children}</>;
  }

  return (
    <ToastProvider>
      {/* 건너뛰기 링크(KWCAG "반복 영역 건너뛰기"): 첫 Tab 에서 나타나 사이드바 메뉴 16개를 건너 본문으로 간다 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        본문 바로가기
      </a>
      <div className="flex h-screen overflow-hidden">
        {navOpen && (
          <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />
        )}
        {/* 좁은 화면에서 닫힌 서랍은 화면 밖으로 밀려 있을 뿐 DOM 에 남는다 → inert 로 Tab·스크린리더에서 제외
            (안 하면 키보드 사용자가 보이지 않는 메뉴 16개를 지나가야 본문에 닿는다). */}
        <div
          id="app-nav"
          ref={drawerRef}
          tabIndex={-1}
          inert={narrow && !navOpen}
          {...(narrow && navOpen ? { role: "dialog", "aria-modal": navOpen === "user", "aria-label": "메뉴" } : {})}
          className={`fixed inset-y-0 left-0 z-50 flex transition-transform duration-200 focus:outline-none lg:static lg:z-auto lg:translate-x-0 lg:transition-none ${navOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"}`}
        >
          <Sidebar />
        </div>
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="lg:hidden no-print flex items-center gap-2 h-12 px-3 border-b border-line bg-white shrink-0">
            <button
              type="button"
              onClick={() => setNavOpen((v) => (v ? false : "user"))}
              className="p-2 rounded hover:bg-slate-100 text-ink-2"
              aria-label={navOpen ? "메뉴 닫기" : "메뉴 열기"}
              aria-expanded={navOpen !== false}
              aria-controls="app-nav"
            >
              {navOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <span className="text-sm font-bold tracking-tight text-ink">정보시스템 자산관리</span>
          </div>
          <SessionExpiryBanner />
          <main id="main-content" tabIndex={-1} data-onboard="main" className="flex-1 overflow-y-auto p-4 lg:p-6 focus:outline-none">{children}</main>
        </div>
      </div>
      <Onboarding />
      <FeedbackModal />
    </ToastProvider>
  );
}

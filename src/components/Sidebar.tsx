"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Server, HardDrive, Globe, Boxes,
  GitBranch, ArrowLeftRight, Wrench, FileText, MapPin, Settings,
  LogOut, User, ScrollText, ClipboardCheck, BarChart3, GripVertical, HelpCircle, MessageSquarePlus,
} from "lucide-react";
import { FEEDBACK_CHANGED_EVENT, openFeedbackModal } from "./FeedbackModal";
import { MENUS, menuKeyForHref } from "@/lib/menus";

// 메뉴 정본은 src/lib/menus.ts (순서·라벨·권한 기본값). 여기서는 key → 아이콘만 매핑한다.
// 포트맵/토폴로지는 레지스트리에 없으므로 메뉴에 나오지 않는다(실데이터 도입 시 레지스트리에 추가, R3 비평).
// 사용자는 드래그로 순서를 바꿀 수 있고 변경 순서는 브라우저(localStorage)에 저장된다(개인 UI 취향 → 서버 스키마 불필요).
const ICONS: Record<string, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard, assets: Server, subassets: Boxes, racks: HardDrive, ipam: Globe,
  distribution: GitBranch, movements: ArrowLeftRight, maintenance: Wrench, inspection: ClipboardCheck,
  contracts: FileText, reports: BarChart3, locations: MapPin, feedback: MessageSquarePlus,
  logs: ScrollText, settings: Settings,
};
const nav = MENUS.map((m) => ({ key: m.key, href: m.href, label: m.label, icon: ICONS[m.key] ?? LayoutDashboard, adminOnly: !!m.adminOnly, defaults: m.defaults }));

const ORDER_KEY = "asset_sidebar_order";

const roleBadge: Record<string, string> = {
  admin: "총괄",
  team: "팀",
  viewer: "전체열람",
};

type NavItem = (typeof nav)[number];

// 저장된 순서(order)를 items 에 적용한다. order 에 있는 항목이 먼저, 없는(새로 추가된) 항목은
// 기본 순서를 유지하며 뒤로. sort 안정성으로 동률(둘 다 미지정)은 원래 순서 보존.
function applyOrder(items: NavItem[], order: string[]): NavItem[] {
  if (!order.length) return items;
  const rank = new Map(order.map((h, i) => [h, i] as const));
  return [...items].sort((a, b) => {
    const ra = rank.has(a.href) ? rank.get(a.href)! : Infinity;
    const rb = rank.has(b.href) ? rank.get(b.href)! : Infinity;
    return ra - rb;
  });
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{
    displayName: string; role: string; username: string;
    permissions?: Record<string, { can_access: number }>;
  } | null>(null);

  // 사용자 지정 메뉴 순서(href 배열). 빈 배열 = 기본 순서.
  const [order, setOrder] = useState<string[]>([]);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setUser(data))
      .catch(() => {});
  }, []);

  // 총괄에게만: 미처리(접수) 개선의견 건수 배지. 접수 이벤트·경로 이동 시 갱신.
  const [openFeedback, setOpenFeedback] = useState(0);
  const isAdmin = user?.role === "admin";
  useEffect(() => {
    if (!isAdmin) return;
    const load = () =>
      fetch("/api/feedback?summary=1")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setOpenFeedback(Number(d.byStatus?.open || 0)))
        .catch(() => {});
    load();
    window.addEventListener(FEEDBACK_CHANGED_EVENT, load);
    return () => window.removeEventListener(FEEDBACK_CHANGED_EVENT, load);
  }, [isAdmin, pathname]);

  // 저장된 순서 로드 (마운트 후 — SSR/hydration 불일치 회피)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ORDER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((h) => typeof h === "string")) setOrder(parsed);
      }
    } catch { /* 무시 */ }
  }, []);

  function persistOrder(next: string[]) {
    setOrder(next);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)); } catch { /* 무시 */ }
  }

  function resetOrder() {
    setOrder([]);
    try { localStorage.removeItem(ORDER_KEY); } catch { /* 무시 */ }
  }

  function startOnboarding() {
    window.dispatchEvent(new Event("asset:onboarding-start"));
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const visible = applyOrder(
    nav.filter((item) => {
      if (item.adminOnly && user?.role !== "admin") return false;
      if (!user || user.role === "admin") return true;
      // 서버 판정과 동일한 폴백: DB 행 → 레지스트리 기본값 (행이 없다고 무조건 보이면 클릭 후 access-denied 로 튙긴다, 비평 반영)
      const perm = user.permissions?.[menuKeyForHref(item.href)];
      if (perm) return !!perm.can_access;
      const d = item.defaults[user.role as "team" | "viewer"];
      return !d || d[0] === 1;
    }),
    order,
  );

  function handleDrop(targetHref: string) {
    if (!dragKey || dragKey === targetHref) return;
    const hrefs = visible.map((i) => i.href);
    const from = hrefs.indexOf(dragKey);
    const to = hrefs.indexOf(targetHref);
    if (from < 0 || to < 0) return;
    const next = [...hrefs];
    next.splice(from, 1);
    next.splice(to, 0, dragKey);
    persistOrder(next);
  }

  const isCustomOrder = order.length > 0;

  return (
    <aside className="w-60 bg-white text-krds-gray-70 flex flex-col shrink-0 border-r border-krds-gray-20">
      {/* 헤더 — KRDS LNB 타이틀 (흰 배경 + 고대비 잉크) */}
      <div className="px-4 py-4 border-b border-krds-gray-10">
        <div className="flex items-center gap-2">
          <span className="led led-up led-live" />
          <span className="eyebrow !text-krds-gray-60">SYSTEM ONLINE</span>
        </div>
        <h1 className="mt-2 text-[15px] font-bold tracking-tight text-krds-gray-90 leading-snug">
          정보시스템 자산관리
        </h1>
      </div>

      <nav data-onboard="nav" className="flex-1 py-3 overflow-y-auto">
        {visible.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const isOver = overKey === href && dragKey !== null && dragKey !== href;
          const isDragging = dragKey === href;
          return (
            <div
              key={href}
              data-onboard="menu"
              data-onboard-href={href}
              draggable
              onDragStart={() => setDragKey(href)}
              onDragOver={(e) => { e.preventDefault(); setOverKey(href); }}
              onDragLeave={() => setOverKey((k) => (k === href ? null : k))}
              onDrop={(e) => { e.preventDefault(); handleDrop(href); setOverKey(null); }}
              onDragEnd={() => { setDragKey(null); setOverKey(null); }}
              className={`${isOver ? "border-t-2 border-krds-primary" : "border-t-2 border-transparent"} ${isDragging ? "opacity-40" : ""}`}
            >
              <Link
                draggable={false}
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={(e) => {
                  // 같은 메뉴(현재 경로)를 다시 클릭하면 작성 중 상태와 무관하게 해당 메뉴 첫 화면으로 초기화
                  const samePage = href === "/" ? pathname === "/" : pathname.startsWith(href);
                  if (samePage) { e.preventDefault(); window.location.assign(href); }
                }}
                className={`group relative flex items-center gap-3 pl-5 pr-3 py-2.5 text-sm transition-colors cursor-grab active:cursor-grabbing ${
                  active
                    ? "text-krds-primary-strong font-semibold bg-krds-primary-bg"
                    : "text-krds-gray-70 hover:text-krds-gray-90 hover:bg-krds-gray-5"
                }`}
              >
                {/* 활성 = KRDS primary 액센트 바 */}
                <span
                  className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full transition-all ${
                    active ? "h-6 bg-krds-primary" : "h-0 bg-transparent"
                  }`}
                />
                <Icon size={18} className={active ? "text-krds-primary" : "text-krds-gray-50"} />
                <span className="flex-1 truncate">{label}</span>
                {href === "/feedback" && openFeedback > 0 && (
                  <span className="num text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-warn/15 text-warn" title={`미처리 의견 ${openFeedback}건`}>
                    {openFeedback}
                  </span>
                )}
                {/* 드래그 핸들 표식 — hover 시 노출 */}
                <GripVertical size={14} className="text-krds-gray-30 opacity-0 group-hover:opacity-70 transition-opacity shrink-0" />
              </Link>
            </div>
          );
        })}

        {isCustomOrder && (
          <button
            onClick={resetOrder}
            className="mt-2 mx-5 text-[0.6875rem] text-krds-gray-50 hover:text-krds-gray-90 transition-colors"
          >
            메뉴 순서 초기화
          </button>
        )}
      </nav>

      {/* 사용자 정보 + 로그아웃 */}
      <div className="p-4 border-t border-krds-gray-10">
        {user ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-md bg-krds-primary-bg flex items-center justify-center shrink-0">
                <User size={15} className="text-krds-primary-strong" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-krds-gray-90 truncate">{user.displayName || user.username}</p>
                <p className="eyebrow !text-[0.625rem] !tracking-[0.1em] !text-krds-gray-60">{roleBadge[user.role] || user.role}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-krds-gray-50 hover:text-fault transition-colors shrink-0"
              title="로그아웃"
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <p className="eyebrow !text-krds-gray-60">v2.0.0</p>
        )}
        <button
          onClick={openFeedbackModal}
          className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-medium text-krds-primary-strong hover:bg-krds-primary-bg rounded-md py-1.5 transition-colors"
          title="현재 화면에서 겪은 불편·개선 의견을 보냅니다"
        >
          <MessageSquarePlus size={14} /> 불편사항 · 개선의견 보내기
        </button>
        <button
          data-onboard="help"
          onClick={startOnboarding}
          className="mt-1.5 w-full flex items-center justify-center gap-1.5 text-xs text-krds-gray-50 hover:text-krds-primary-strong transition-colors"
          title="온보딩 다시 보기"
        >
          <HelpCircle size={14} /> 도움말 · 사용 안내 다시 보기
        </button>
      </div>
    </aside>
  );
}

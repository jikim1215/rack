"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Server, HardDrive, Cable, Network, Globe,
  GitBranch, ArrowLeftRight, Wrench, FileText, MapPin, Settings,
  LogOut, User,
} from "lucide-react";

const nav = [
  { href: "/", label: "대시보드", icon: LayoutDashboard },
  { href: "/assets", label: "자산관리", icon: Server },
  { href: "/racks", label: "랙 실장도", icon: HardDrive },
  { href: "/portmap", label: "포트맵", icon: Cable },
  { href: "/topology", label: "토폴로지", icon: Network },
  { href: "/ipam", label: "IP관리", icon: Globe },
  { href: "/distribution", label: "배선관리", icon: GitBranch },
  { href: "/movements", label: "반입/반출", icon: ArrowLeftRight },
  { href: "/maintenance", label: "유지보수", icon: Wrench },
  { href: "/contracts", label: "계약관리", icon: FileText },
  { href: "/locations", label: "위치관리", icon: MapPin },
  { href: "/settings", label: "설정", icon: Settings },
];

const roleBadge: Record<string, string> = {
  admin: "관리자",
  user: "사용자",
  viewer: "열람자",
};

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{
    displayName: string; role: string; username: string;
    permissions?: Record<string, { can_access: number }>;
  } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setUser(data))
      .catch(() => {});
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-60 bg-rail text-slate-300 flex flex-col shrink-0">
      {/* 장비 전면 패널 헤더 */}
      <div className="px-4 py-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="led led-up led-live" />
          <span className="eyebrow">SYSTEM ONLINE</span>
        </div>
        <h1 className="mt-2 text-[15px] font-semibold tracking-tight text-white leading-snug">
          정보시스템 자산관리
        </h1>
      </div>

      <nav className="flex-1 py-3 overflow-y-auto">
        {nav.filter(({ href }) => {
          if (!user?.permissions) return true;
          const key = href === '/' ? 'dashboard' : href.slice(1);
          const perm = user.permissions[key];
          return !perm || perm.can_access;
        }).map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex items-center gap-3 pl-5 pr-4 py-2.5 text-sm transition-colors ${
                active
                  ? "text-white font-medium bg-white/[0.06]"
                  : "text-slate-400 hover:text-white hover:bg-white/[0.03]"
              }`}
            >
              {/* 활성 = 포트 LED 틱 */}
              <span
                className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full transition-all ${
                  active ? "h-5 bg-signal" : "h-0 bg-transparent"
                }`}
              />
              <Icon size={18} className={active ? "text-signal" : ""} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* 사용자 정보 + 로그아웃 */}
      <div className="p-4 border-t border-white/10">
        {user ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-md bg-white/[0.06] flex items-center justify-center shrink-0">
                <User size={15} className="text-slate-400" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{user.displayName || user.username}</p>
                <p className="eyebrow !text-[0.625rem] !tracking-[0.1em]">{roleBadge[user.role] || user.role}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-slate-500 hover:text-fault transition-colors shrink-0"
              title="로그아웃"
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <p className="eyebrow">v2.0.0</p>
        )}
      </div>
    </aside>
  );
}

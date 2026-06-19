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
    <aside className="w-[260px] bg-[#1d1d1f] text-white/80 flex flex-col shrink-0">
      {/* 헤더 */}
      <div className="px-5 pt-7 pb-5">
        <div className="flex items-center gap-2.5">
          <span className="led led-up led-live" />
          <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-white/40 font-mono">System Online</span>
        </div>
        <h1 className="text-[21px] font-semibold tracking-[-0.01em] text-white leading-tight mt-4">
          정보시스템<br />자산관리
        </h1>
      </div>

      {/* 구분선 */}
      <div className="mx-5 h-px bg-white/[0.08]" />

      {/* 네비게이션 */}
      <nav className="flex-1 py-3 px-3 overflow-y-auto">
        <div className="space-y-0.5">
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
                className={`flex items-center gap-3 px-3 py-[9px] text-[14px] rounded-[10px] transition-all duration-200 ${
                  active
                    ? "text-white font-medium bg-white/[0.12]"
                    : "text-white/50 hover:text-white/80 hover:bg-white/[0.05]"
                }`}
              >
                <Icon size={17} strokeWidth={active ? 2 : 1.5} className={active ? "text-[#34c759]" : ""} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* 사용자 */}
      <div className="mx-5 h-px bg-white/[0.08]" />
      <div className="px-5 py-4">
        {user ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-8 h-8 rounded-full bg-white/[0.08] flex items-center justify-center shrink-0">
                <User size={14} className="text-white/40" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-white truncate">{user.displayName || user.username}</p>
                <p className="text-[10px] text-white/30 tracking-wider font-semibold uppercase">{roleBadge[user.role] || user.role}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-white/30 hover:text-[#ff3b30] transition-colors rounded-lg hover:bg-white/[0.05]"
              title="로그아웃"
            >
              <LogOut size={15} />
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-white/30 tracking-wider font-semibold uppercase">v2.0.0</p>
        )}
      </div>
    </aside>
  );
}

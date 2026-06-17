"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Server,
  HardDrive,
  Cable,
  MapPin,
  GitBranch,
  LogOut,
  User,
  Settings,
} from "lucide-react";

const nav = [
  { href: "/", label: "대시보드", icon: LayoutDashboard },
  { href: "/assets", label: "자산관리", icon: Server },
  { href: "/racks", label: "랙 실장도", icon: HardDrive },
  { href: "/portmap", label: "포트맵", icon: Cable },
  { href: "/distribution", label: "배선관리", icon: GitBranch },
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
  const [user, setUser] = useState<{ displayName: string; role: string; username: string } | null>(null);

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
    <aside className="w-60 bg-slate-900 text-white flex flex-col shrink-0">
      <div className="p-4 border-b border-slate-700">
        <h1 className="text-lg font-bold tracking-tight">🖥️ 자산관리</h1>
        <p className="text-xs text-slate-400 mt-1">정보시스템 관리 솔루션</p>
      </div>
      <nav className="flex-1 py-2">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                active
                  ? "bg-blue-600 text-white font-medium"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* 사용자 정보 + 로그아웃 */}
      <div className="p-4 border-t border-slate-700">
        {user ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <User size={16} className="text-slate-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{user.displayName || user.username}</p>
                <p className="text-xs text-slate-500">{roleBadge[user.role] || user.role}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-slate-500 hover:text-red-400 transition-colors shrink-0"
              title="로그아웃"
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">v2.0.0</p>
        )}
      </div>
    </aside>
  );
}

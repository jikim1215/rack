"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Server,
  Network,
  Shield,
  HardDrive,
  Cable,
  MapPin,
} from "lucide-react";

const nav = [
  { href: "/", label: "대시보드", icon: LayoutDashboard },
  { href: "/assets", label: "자산관리", icon: Server },
  { href: "/racks", label: "랙 실장도", icon: HardDrive },
  { href: "/portmap", label: "포트맵", icon: Cable },
  { href: "/locations", label: "위치관리", icon: MapPin },
];

export function Sidebar() {
  const pathname = usePathname();

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
      <div className="p-4 border-t border-slate-700 text-xs text-slate-500">
        v1.0.0
      </div>
    </aside>
  );
}

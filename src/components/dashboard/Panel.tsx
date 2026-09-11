// ── 계기 패널 (공용 카드 래퍼) ─────────────────────────────
import type { ReactNode } from "react";

export default function Panel({
  title, code, icon, children, className = "",
}: {
  title: string; code?: string; icon?: ReactNode;
  children: ReactNode; className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          {icon}
          {title}
        </div>
        {code && <span className="eyebrow">{code}</span>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

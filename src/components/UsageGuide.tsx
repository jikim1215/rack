"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * 화면별 접이식 "사용법" 가이드 — '사용법' 토글 버튼 + 불릿 목록.
 * 배치는 호출부가 결정한다(대개 필터바 우측 또는 타이틀 아래).
 * 항목 강조는 <strong className="text-ink-2">…</strong> 컨벤션을 따른다.
 * 접힘/펼침 상태는 화면(pathname)별로 localStorage에 기억한다 (외부 검토 R4-2 합의:
 * 초보 사용자가 화면 진입 때마다 다시 열어야 하는 반복 비용 제거).
 */
export function UsageGuide({ items, className }: { items: ReactNode[]; className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(`usage-guide:${location.pathname}`) === "1");
    } catch { /* 저장 불가 환경은 기본 접힘 유지 */ }
  }, []);
  const toggle = () =>
    setOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(`usage-guide:${location.pathname}`, next ? "1" : "0"); } catch { /* 무시 */ }
      return next;
    });
  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        className="text-xs text-ink-3 hover:text-ink inline-flex items-center gap-1"
      >
        사용법 {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="mt-2 text-xs text-ink-3 space-y-0.5 border-l-2 border-line pl-3 text-left">
          {items.map((item, i) => (
            <p key={i}>• {item}</p>
          ))}
        </div>
      )}
    </div>
  );
}

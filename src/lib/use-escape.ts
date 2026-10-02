"use client";
// 모달·팝오버·컨텍스트 메뉴를 Esc 로 닫는다 (KWCAG 2.2 "키보드 사용 보장" — 마우스 바깥 클릭만으로 닫히는 레이어 금지).
import { useEffect, useRef } from "react";

/** active 인 동안 Esc 키로 onClose 를 부른다. onClose 가 렌더마다 새 함수여도 리스너는 다시 달지 않는다. */
export function useEscape(active: boolean, onClose: () => void): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") ref.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}

// 접근성 보조 — 버튼으로 바꿀 수 없는(안에 다른 버튼이 들어 있거나 표 행 등) 클릭 영역을 키보드로도 쓰게 한다.
// KWCAG 2.2 "키보드 사용 보장": 마우스 onClick 만 있는 div 는 Tab 으로 닿지 않고 Enter/Space 로 실행되지 않는다.
// 순수 모듈(React 타입만) — 단위 테스트에서 그대로 불러 쓴다.
import type { KeyboardEvent } from "react";

/** 클릭 영역에 펼칠 props: 포커스 가능 + 버튼 역할 + Enter/Space 실행. 자식 컨트롤에서 올라온 키 입력은 무시한다. */
export function pressable(onActivate: () => void, opts: { pressed?: boolean; expanded?: boolean; label?: string } = {}) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return; // 안쪽 입력칸/버튼의 Enter·Space 는 그쪽 몫
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); // Space 의 페이지 스크롤 방지
        onActivate();
      }
    },
    ...(opts.pressed !== undefined ? { "aria-pressed": opts.pressed } : {}),
    ...(opts.expanded !== undefined ? { "aria-expanded": opts.expanded } : {}),
    ...(opts.label !== undefined ? { "aria-label": opts.label } : {}),
  };
}

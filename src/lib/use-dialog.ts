"use client";
// 모달 대화상자 키보드 계약(KWCAG 2.2 "키보드 사용 보장"·"초점 이동과 표시", WAI-ARIA APG Dialog 패턴):
//  · 열리면 대화상자 안으로 초점 이동(initialFocus → 첫 초점 요소 → 대화상자 자신)
//  · Tab/Shift+Tab 은 대화상자 안에서만 순환(뒤 화면으로 새지 않음)
//  · Esc 로 닫힘 — 겹친 경우 맨 위 대화상자만
//  · 닫히면 연 요소(트리거)로 초점 복귀 — 사라졌으면 본문(#main-content)
// 대화상자 루트에 ref 를 달면 된다. 팝오버·컨텍스트 메뉴처럼 비모달 레이어는 use-escape.ts.
import { useCallback, useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]", "area[href]", "button:not([disabled])", "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])", "textarea:not([disabled])", "iframe", "[contenteditable=true]", "[tabindex]:not([tabindex='-1'])",
].join(",");

/** 대화상자 안에서 Tab 으로 갈 수 있는 요소(보이는 것만, DOM 순서). */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[inert]") && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0),
  );
}

interface Entry { root: () => HTMLElement | null; close: () => void }
const stack: Entry[] = [];

// 열린 대화상자 밖에서 최근 초점을 받은 요소 2개(최신이 [0]). 대화상자 안 autoFocus 는 커밋 중(useDialog effect 가
// 스택에 올리기 전)에 실행되므로 그 입력칸도 여기 기록된다 → effect 에서 "새 대화상자 밖인 가장 최근 것"을 트리거로 고른다.
const recentFocus: (HTMLElement | null)[] = [null, null];
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => {
    const t = e.target as HTMLElement;
    if (stack.some((d) => d.root()?.contains(t))) return;
    if (recentFocus[0] !== t) { recentFocus[1] = recentFocus[0]; recentFocus[0] = t; }
  }, true);
}

function onKeyDown(e: KeyboardEvent) {
  const top = stack[stack.length - 1];
  const root = top?.root();
  if (!top || !root) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    top.close();
    return;
  }
  if (e.key !== "Tab") return;
  const next = trapTarget<Element>(focusableIn(root), document.activeElement, root, (el) => root.contains(el), e.shiftKey);
  if (next instanceof HTMLElement) { e.preventDefault(); next.focus(); }
}

/**
 * Tab 가두기 결정(순수 함수): 브라우저 기본 이동에 맡기면 되면 null, 아니면 초점을 옮길 대상.
 * 끝에서 Tab → 처음, 처음(또는 대화상자 자신)에서 Shift+Tab → 끝, 초점이 밖에 있으면 안으로 끌어온다.
 */
export function trapTarget<E>(items: E[], active: E | null, root: E, inside: (el: E) => boolean, shift: boolean): E | null {
  if (items.length === 0) return root;
  const first = items[0], last = items[items.length - 1];
  const outside = !active || !inside(active);
  if (shift) return outside || active === first || active === root ? last : null;
  return outside || active === last ? first : null;
}

/**
 * 모달 대화상자 훅. `active` 동안 초점 가두기·Esc 닫기·닫힐 때 초점 복귀.
 * 반환된 ref 를 대화상자 루트(role="dialog")에 단다. 루트는 tabIndex={-1} 이어야 초점 요소가 없을 때도 초점을 받는다.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(
  active: boolean,
  onClose: () => void,
  opts: {
    initialFocus?: () => HTMLElement | null | undefined;
    /** 닫힐 때 트리거 대신 보낼 곳(예: 서랍 메뉴로 화면 이동 → 새 화면 본문). null/undefined 면 기본(트리거). */
    returnFocus?: () => HTMLElement | null | undefined;
  } = {},
) {
  const rootRef = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const initialRef = useRef(opts.initialFocus);
  initialRef.current = opts.initialFocus;
  const returnRef = useRef(opts.returnFocus);
  returnRef.current = opts.returnFocus;

  useEffect(() => {
    if (!active) return;
    const focused = document.activeElement as HTMLElement | null;
    const inNew = (el: HTMLElement | null) => !!el && !!rootRef.current?.contains(el);
    const opener = !inNew(focused) ? focused : (recentFocus.find((el) => el && !inNew(el)) ?? null);
    const entry: Entry = { root: () => rootRef.current, close: () => closeRef.current() };
    stack.push(entry);
    if (stack.length === 1) document.addEventListener("keydown", onKeyDown, true);
    const root = rootRef.current;
    if (root && !root.contains(document.activeElement)) {
      (initialRef.current?.() ?? focusableIn(root)[0] ?? root).focus();
    }
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) document.removeEventListener("keydown", onKeyDown, true);
      // 닫힌 뒤 초점 복귀: 트리거가 아직 화면에 있으면 거기로, 없으면 본문으로(초점이 body 로 증발하지 않게).
      // 사용자가 이미 다른 곳(예: 서랍 메뉴 링크로 이동한 새 화면)에 초점을 뒀다면 건드리지 않는다.
      requestAnimationFrame(() => {
        const override = returnRef.current?.();
        if (override) { override.focus(); return; }
        const now = document.activeElement;
        const lost = !now || now === document.body || !now.isConnected || (root?.contains(now) ?? false);
        if (!lost) return;
        const target = opener && opener.isConnected && opener !== document.body && !root?.contains(opener)
          ? opener : document.getElementById("main-content");
        target?.focus();
      });
    };
  }, [active]);

  return useCallback((el: T | null) => { rootRef.current = el; }, []);
}

// tests/a11y-keyboard.test.ts — 키보드 사용 보장 가드 (KWCAG 2.2)
// (1) pressable(): 버튼으로 바꿀 수 없는 클릭 영역에 role/tabIndex/Enter·Space 를 준다 — 동작 단위 점검.
// (2) 정적 스캔: div/span/td/tr/li 등 비대화형 요소의 onClick 은 pressable(…)·role·onKeyDown 중 하나를 같이 가져야 한다.
//     마우스로만 열리는 화면 기능은 키보드·스크린리더 사용자에게 없는 기능이다. 예외는 사유와 함께 아래 목록에 고정.
// (3) 모달/팝오버(fixed inset-0 레이어)를 쓰는 파일은 Esc 로 닫혀야 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pressable } from "../src/lib/a11y.ts";
import { trapTarget } from "../src/lib/use-dialog.ts";

const SRC = join(process.cwd(), "src");
const NON_INTERACTIVE = /^<(div|span|td|tr|li|p|section|article|ul|img)\b/;

/** 키보드 대체 수단이 따로 있는 마우스 전용 클릭 (파일:요소 시작 줄 → 사유). */
const EXEMPT: Record<string, string> = {
  "app/assets/AssetTable.tsx:<tr": "행 클릭=마우스 편의. 키보드는 같은 행의 펼치기 버튼(aria-expanded)으로 같은 동작",
};
/** 모달 바깥(백드롭) 클릭으로 닫기 — Esc(useEscape 등)와 닫기 버튼이 키보드 대체. */
const BACKDROP = /className="[^"]*\bfixed inset-0\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** JSX 여는 태그 텍스트 (속성 식 안의 > 와 문자열 고려). */
function openTag(src: string, lt: number): string {
  let brace = 0;
  let quote: string | null = null;
  for (let j = lt + 1; j < src.length; j++) {
    const c = src[j];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { if (brace === 0 || c === "`") quote = c; continue; }
    if (c === "{") brace++;
    else if (c === "}") brace--;
    else if (c === ">" && brace === 0) return src.slice(lt, j + 1);
  }
  return src.slice(lt);
}

export function mouseOnlyClicks(src: string): { line: number; tag: string }[] {
  const out: { line: number; tag: string }[] = [];
  for (const m of src.matchAll(/<(div|span|td|tr|li|p|section|article|ul|img)\b/g)) {
    const tag = openTag(src, m.index!);
    if (!NON_INTERACTIVE.test(tag) || !/\bonClick=/.test(tag)) continue;
    if (/\bonClick=\{\(e\) => e\.stopPropagation\(\)\}/.test(tag)) continue; // 전파 차단 래퍼(안쪽 버튼 보호)
    if (/\bpressable\(|\brole="|\bonKeyDown=/.test(tag)) continue;
    if (BACKDROP.test(tag)) continue;
    out.push({ line: src.slice(0, m.index).split("\n").length, tag: `<${m[1]}` });
  }
  return out;
}

const key = (e: { key: string; target?: unknown; currentTarget?: unknown }) => {
  let prevented = false;
  const ev = { target: e.target ?? 1, currentTarget: e.currentTarget ?? 1, key: e.key, preventDefault: () => { prevented = true; } };
  return { ev: ev as never, prevented: () => prevented };
};

test("pressable: 버튼 역할·포커스 가능, Enter/Space 로 실행하고 Space 스크롤을 막는다", () => {
  let n = 0;
  const p = pressable(() => n++, { pressed: true, label: "선택" });
  assert.equal(p.role, "button");
  assert.equal(p.tabIndex, 0);
  assert.equal(p["aria-pressed" as keyof typeof p], true);
  assert.equal(p["aria-label" as keyof typeof p], "선택");
  const enter = key({ key: "Enter" }); p.onKeyDown(enter.ev); assert.equal(n, 1); assert.ok(enter.prevented());
  const space = key({ key: " " }); p.onKeyDown(space.ev); assert.equal(n, 2); assert.ok(space.prevented());
  const tab = key({ key: "Tab" }); p.onKeyDown(tab.ev); assert.equal(n, 2); assert.ok(!tab.prevented(), "Tab 이동은 막지 않는다");
  p.onClick(); assert.equal(n, 3);
});

test("pressable: 안쪽 입력칸·버튼에서 올라온 Enter 는 가로채지 않는다", () => {
  let n = 0;
  const p = pressable(() => n++);
  const inner = key({ key: "Enter", target: "child", currentTarget: "card" });
  p.onKeyDown(inner.ev);
  assert.equal(n, 0);
  assert.ok(!inner.prevented());
  assert.ok(!("aria-pressed" in p) && !("aria-expanded" in p), "지정하지 않은 상태 속성은 붙이지 않는다");
});

test("스캐너 자체 점검", () => {
  assert.equal(mouseOnlyClicks(`<div className="x" onClick={() => go()}>`).length, 1);
  assert.equal(mouseOnlyClicks(`<div {...pressable(() => go())} className="x">`).length, 0);
  assert.equal(mouseOnlyClicks(`<div onClick={() => go()} onKeyDown={k}>`).length, 0);
  assert.equal(mouseOnlyClicks(`<div onClick={(e) => e.stopPropagation()}>`).length, 0);
  assert.equal(mouseOnlyClicks(`<div className="fixed inset-0 bg-black/30" onClick={close}>`).length, 0);
  assert.equal(mouseOnlyClicks(`<button onClick={() => go()}>`).length, 0);
  assert.equal(mouseOnlyClicks(`<div onClick={() => { if (a > b) go(); }} className="x">`).length, 1, "속성 식 안의 > 에 속지 않는다");
});

test("비대화형 요소의 마우스 전용 onClick 이 없다 (KWCAG 키보드 사용 보장)", () => {
  const bad: string[] = [];
  const usedExempt = new Set<string>();
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split(sep).join("/");
    for (const x of mouseOnlyClicks(readFileSync(file, "utf8"))) {
      const k = `${rel}:${x.tag}`;
      if (EXEMPT[k]) { usedExempt.add(k); continue; }
      bad.push(`${rel}:${x.line} ${x.tag}`);
    }
  }
  assert.deepEqual(bad, [], `키보드로 쓸 수 없는 클릭 영역 — <button> 으로 바꾸거나 {...pressable(fn)} 을 쓰세요:\n${bad.join("\n")}`);
  assert.deepEqual(Object.keys(EXEMPT).filter((k) => !usedExempt.has(k)), [], "쓰이지 않는 예외 항목은 지운다");
});

test("모달·팝오버 레이어를 쓰는 화면은 Esc 로 닫힌다", () => {
  const missing: string[] = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8");
    if (!/\bfixed inset-0\b/.test(src)) continue;
    const rel = relative(SRC, file).split(sep).join("/");
    if (rel === "components/Onboarding.tsx") continue; // 온보딩 투어: 딤은 장식, 닫기·건너뛰기 버튼이 포커스 대상
    if (!/useEscape\(|useDialog\(|"Escape"/.test(src)) missing.push(rel);
  }
  assert.deepEqual(missing, [], `Esc 로 닫히지 않는 레이어:\n${missing.join("\n")}`);
});

test("모달 대화상자(aria-modal)는 useDialog 로 — 초점 가두기·Esc·초점 복귀, 루트는 ref + tabIndex={-1}", () => {
  const bad: string[] = [];
  let count = 0;
  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8");
    const rel = relative(SRC, file).split(sep).join("/");
    for (const m of src.matchAll(/<div\b((?:[^>"{]|"[^"]*"|\{(?:[^{}]|\{[^{}]*\})*\})*)>/g)) {
      const attrs = m[1];
      if (!/role="(alert)?dialog"/.test(attrs) || !/aria-modal="true"/.test(attrs)) continue;
      count++;
      const line = src.slice(0, m.index).split("\n").length;
      if (!/\bref=\{\w+\}/.test(attrs) || !/tabIndex=\{-1\}/.test(attrs)) bad.push(`${rel}:${line} 루트에 ref·tabIndex={-1} 없음`);
      if (!/useDialog\(/.test(src)) bad.push(`${rel}:${line} useDialog 미사용`);
    }
  }
  assert.ok(count >= 5, `모달 ${count}개 — 스캐너가 대화상자를 못 찾음`);
  assert.deepEqual(bad, []);
});

test("trapTarget: 끝↔처음 순환, 밖의 초점은 안으로, 중간은 브라우저 기본 이동", () => {
  const [a, b, c, root, outsideEl] = ["a", "b", "c", "root", "x"];
  const items = [a, b, c];
  const inside = (el: string) => el !== "x";
  assert.equal(trapTarget(items, c, root, inside, false), a, "마지막에서 Tab → 처음");
  assert.equal(trapTarget(items, a, root, inside, true), c, "처음에서 Shift+Tab → 마지막");
  assert.equal(trapTarget(items, root, root, inside, true), c, "대화상자 자신에서 Shift+Tab → 마지막");
  assert.equal(trapTarget(items, b, root, inside, false), null, "중간은 기본 이동");
  assert.equal(trapTarget(items, b, root, inside, true), null);
  assert.equal(trapTarget(items, outsideEl, root, inside, false), a, "밖에 있으면 처음으로 끌어옴");
  assert.equal(trapTarget(items, null, root, inside, true), c);
  assert.equal(trapTarget([], a, root, inside, false), root, "초점 요소가 없으면 대화상자 자신");
});

test("좁은 화면 서랍: 닫히면 inert(보이지 않는 메뉴로 Tab 이 새지 않음), 햄버거로 열면 useDialog", () => {
  const shell = readFileSync(join(SRC, "components", "LayoutShell.tsx"), "utf8");
  assert.match(shell, /inert=\{narrow && !navOpen\}/);
  assert.match(shell, /useDialog\(narrow && navOpen === "user"/);
});

test("본문 바로가기 링크가 본문(main#main-content)을 가리킨다 (반복 영역 건너뛰기)", () => {
  const shell = readFileSync(join(SRC, "components", "LayoutShell.tsx"), "utf8");
  const link = shell.indexOf('href="#main-content"');
  const firstNav = shell.indexOf("<Sidebar");
  assert.ok(link >= 0, "건너뛰기 링크 없음");
  assert.ok(link < firstNav, "건너뛰기 링크는 사이드바보다 앞(첫 Tab)이어야 한다");
  assert.match(shell, /<main id="main-content" tabIndex=\{-1\}/, "본문은 링크 대상 id + 프로그램 포커스(tabIndex=-1)");
  assert.match(shell, /className="sr-only focus:not-sr-only/, "평소엔 숨기고 포커스 때 보인다");
});

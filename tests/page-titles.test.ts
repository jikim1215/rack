// tests/page-titles.test.ts — 화면별 탭 제목 가드 (KWCAG 2.2 "제목 제공")
// 모든 화면(src/app/**/page.tsx)은 자기 제목을 가져야 한다: page.tsx 의 `export const metadata`
// 또는 (클라이언트 page 라 metadata 를 못 내보내면) 같은 폴더 layout.tsx 의 metadata. 루트 레이아웃 template 이
// "제목 · 정보시스템 자산관리" 로 감싼다. 새 화면을 추가하면서 제목을 빼먹으면 이 테스트가 실패한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { MENUS, menuTitle } from "../src/lib/menus.ts";

const APP = join(process.cwd(), "src", "app");

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "api") pages(p, out); }
    else if (name === "page.tsx") out.push(p);
  }
  return out;
}

const META = /^export const metadata\b/m;

test("menuTitle 은 사이드바 메뉴 이름을 제목으로 쓴다", () => {
  for (const m of MENUS) assert.deepEqual(menuTitle(m.key), { title: m.label });
  assert.throws(() => menuTitle("no-such-menu" as never), /unknown menu key/);
});

test("루트 레이아웃은 화면 제목 template 을 두고, 같은 세그먼트인 대시보드는 absolute 로 같은 꼴을 맞춘다", () => {
  const src = readFileSync(join(APP, "layout.tsx"), "utf8");
  assert.match(src, /template:\s*"%s · 정보시스템 자산관리"/);
  // template 은 하위 세그먼트에만 적용 — 루트 page 는 직접 "… · 정보시스템 자산관리" 를 써야 탭에서 앱이 식별된다
  assert.match(readFileSync(join(APP, "page.tsx"), "utf8"), /absolute: `\$\{menuTitle\("dashboard"\)\.title\} · 정보시스템 자산관리`/);
});

test("모든 화면이 자기 제목(metadata)을 내보낸다", () => {
  const missing: string[] = [];
  for (const page of pages(APP)) {
    // 루트 layout.tsx 의 metadata 는 기본 제목이라 대신할 수 없다 — 하위 폴더 layout 만 인정
    const layout = join(dirname(page), "layout.tsx");
    const ok = META.test(readFileSync(page, "utf8")) || (dirname(page) !== APP && existsSync(layout) && META.test(readFileSync(layout, "utf8")));
    if (!ok) missing.push(relative(APP, page));
  }
  assert.deepEqual(missing, [], `제목 없는 화면 — page.tsx 에 export const metadata = menuTitle("키") 또는 { title } 을 추가하세요:\n${missing.join("\n")}`);
});

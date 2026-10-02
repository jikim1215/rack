// tests/a11y-contrast.test.ts — 색 토큰 명도 대비 가드 (KWCAG 2.2 "텍스트 콘텐츠의 명도 대비" 4.5:1)
// globals.css @theme 의 글자색 토큰이 앱이 실제로 까는 배경(흰 패널·표면·slate-100·자기 색 10~15% 틴트 배지) 위에서
// 4.5:1 을 넘는지, 상태색 배경 위 흰 글자도 4.5:1 인지 계산한다. 토큰을 "예쁘게" 밝히다 대비를 깨면 실패한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");
const CSS = readFileSync(join(SRC, "app", "globals.css"), "utf8");
const theme = CSS.slice(CSS.indexOf("@theme"), CSS.indexOf("}", CSS.indexOf("@theme")));

type RGB = [number, number, number];
function token(name: string): RGB {
  const m = new RegExp(`--color-${name}:\\s*#([0-9a-fA-F]{6})\\b`).exec(theme);
  assert.ok(m, `@theme 에 --color-${name} 가 없다`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as RGB;
}
const hex = (h: string): RGB => [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16)) as RGB;
const lum = (c: RGB) => {
  const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const tint = (c: RGB, bg: RGB, a: number): RGB => c.map((v, i) => Math.round(v * a + bg[i] * (1 - a))) as RGB;

const WHITE = hex("#ffffff");
const SLATE_100 = hex("#f1f5f9");

test("대비 계산 자체 점검 (WCAG 기준값)", () => {
  assert.equal(contrast(hex("#000000"), WHITE).toFixed(1), "21.0");
  assert.equal(contrast(WHITE, WHITE), 1);
  assert.equal(contrast(hex("#767676"), WHITE).toFixed(2), "4.54"); // 흰 배경 AA 최소 회색으로 널리 쓰이는 값
});

test("글자색 토큰은 앱의 모든 기본 배경 위에서 4.5:1 이상", () => {
  const surface = token("surface");
  const bad: string[] = [];
  for (const name of ["ink", "ink-2", "ink-3", "signal", "warn", "fault", "krds-primary-strong", "krds-gray-60", "krds-gray-70"]) {
    const c = token(name);
    const bgs: Record<string, RGB> = { white: WHITE, surface, "slate-100": SLATE_100, "tint10": tint(c, WHITE, 0.1), "tint15": tint(c, WHITE, 0.15) };
    for (const [bgName, bg] of Object.entries(bgs)) {
      const r = contrast(c, bg);
      if (r < 4.5) bad.push(`${name} on ${bgName}: ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("상태색 배경 위 흰 글자 4.5:1, 유휴색(큰 숫자·LED)은 3:1 이상", () => {
  for (const name of ["signal", "warn", "fault", "ink", "krds-primary-strong", "idle"]) {
    const r = contrast(WHITE, token(name));
    assert.ok(r >= 4.5, `흰 글자 on ${name}: ${r.toFixed(2)}`);
  }
  for (const bg of [WHITE, token("surface")]) {
    const r = contrast(token("idle"), bg);
    assert.ok(r >= 3, `idle on bg: ${r.toFixed(2)}`);
  }
});

test("@theme 밖에 정의돼 클래스가 생성되지 않는 색 이름을 쓰지 않는다", () => {
  // text-warning / bg-success 등은 Tailwind 가 만들지 않아 무색으로 렌더됐다(실제 결함) — 토큰은 signal/warn/fault.
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(n)) {
        readFileSync(p, "utf8").split("\n").forEach((line, i) => {
          if (/\b(text|bg|border|ring|fill)-(success|warning|danger)\b/.test(line)) hits.push(`${relative(SRC, p)}:${i + 1}`);
        });
      }
    }
  };
  walk(SRC);
  assert.deepEqual(hits, []);
});

test("짙은 배경(rail·ink) 위엔 밝은 글자 — 밝은 표면용 ink 토큰을 그대로 얹지 않는다", () => {
  // 실제 결함: 설정의 팀·사용자 추가 폼이 bg-rail 이라 라벨(ink-2) 2.4:1·추가 버튼(btn-ink) 1.1:1 로 거의 안 보였고,
  // 로그인 하단 안내는 ink-3 3.3:1·강조어 ink-2 2.4:1(강조가 오히려 더 어두움)이었다.
  const rail = token("rail");
  for (const name of ["ink", "ink-2", "ink-3"]) assert.ok(contrast(token(name), rail) < 4.5, `${name} 은 rail 위에서 쓸 수 없는 색(가드 전제)`);
  assert.ok(contrast(hex("#94a3b8"), rail) >= 4.5, "slate-400 on rail"); // 로그인 하단 안내
  assert.ok(contrast(hex("#e2e8f0"), rail) >= 4.5, "slate-200 on rail");

  // bg-rail 은 화면 바탕(로그인·비밀번호 변경 — 내용은 흰 패널 안)에만. 폼·목록 패널엔 bg-surface.
  // 클래스 문자열(따옴표 한 묶음) 단위로 본다 — 선택 시 "bg-ink text-white" : 아니면 "text-ink-2" 같은 삼항은 서로 다른 묶음.
  const RAIL_OK = new Set(["app/login/page.tsx", "app/change-password/page.tsx"]);
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".tsx")) {
        const rel = relative(SRC, p).replaceAll("\\", "/");
        readFileSync(p, "utf8").split("\n").forEach((line, i) => {
          // 템플릿의 ${…} 안(삼항의 각 갈래)은 따로 떼어 각자 한 묶음으로 본다
          const parts = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
          for (const m of line.matchAll(/`([^`]*)`/g)) parts.push(m[1].replace(/\$\{[^}]*\}/g, " "));
          for (const raw of parts) {
            const cls = raw.replace(/\b[\w-]+:bg-\S+/g, ""); // hover:·focus: 변형은 상태 배경이라 제외
            if (!/\bbg-(rail|ink)\b/.test(cls)) continue;
            if (RAIL_OK.has(rel) && /\bbg-rail\b/.test(cls)) continue;
            if (/\bbg-ink\b/.test(cls) && /\b(w|h)-\d/.test(cls) && /\brounded-full\b/.test(cls) && !/\btext-/.test(cls)) continue; // 글자 없는 점 표시
            if (!/\btext-white\b/.test(cls) || /\btext-ink(-2|-3)?\b/.test(cls)) hits.push(`${rel}:${i + 1}`);
          }
        });
      }
    }
  };
  walk(SRC);
  assert.deepEqual(hits, []);

  // 글자색을 지정하는 공용 클래스(.eyebrow 등)는 components 레이어 — 무계층이면 덧붙인 text-* 유틸리티를 이겨서
  // 'eyebrow text-slate-400' 이 소스상으론 7:1 인데 화면은 ink-3(3.3:1)으로 그려졌다(실제 결함).
  for (const cls of ["eyebrow", "form-input"]) {
    const at = CSS.indexOf(`.${cls} {`);
    assert.ok(at > 0, cls);
    const before = CSS.slice(0, at);
    const opened = (before.match(/@layer components \{/g) ?? []).length;
    const lastLayer = before.lastIndexOf("@layer components {");
    const between = CSS.slice(lastLayer, at);
    const depth = (between.match(/\{/g) ?? []).length - (between.match(/\}/g) ?? []).length;
    assert.ok(opened > 0 && lastLayer >= 0 && depth >= 1, `.${cls} 가 @layer components 안에 있어야 한다`);
  }

  // bg-rail 바탕 화면에서 흰 패널 밖에 놓인 글자(로그인 하단 안내)는 ink 토큰 금지
  for (const f of RAIL_OK) {
    const src = readFileSync(join(SRC, f), "utf8");
    const outside = src.slice(src.lastIndexOf("</div>\n        </div>"));
    assert.doesNotMatch(outside, /\btext-ink(-2|-3)?\b/, `${f}: 패널 밖 글자`);
  }
});

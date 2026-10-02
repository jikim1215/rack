// tests/a11y-form-labels.test.ts — 폼 컨트롤 접근 가능한 이름 가드 (KWCAG 2.2 "레이블 제공" 회귀 방지)
// src/**/*.tsx 의 <input>/<select>/<textarea> 는 스크린리더가 읽을 이름이 있어야 한다:
// aria-label / aria-labelledby / title, 또는 <label>·<FormField> 안에 감싸짐, 또는 id 가 같은 파일의 htmlFor 와 짝.
// 형제 <label> 이 시각적으로만 붙어 있고 연결되지 않은 경우가 주 실패 패턴이라 정적 스캔으로 막는다.
// 추가로 aria-label 값이 입력 예시(placeholder 를 그대로 옮긴 "예: …", "000000", "/assets" 등)면 이름 구실을 못 하므로 실패.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");
const SKIP_INPUT_TYPES = new Set(["hidden", "checkbox", "radio", "file", "submit", "button"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** `<` 위치에서 JSX 태그 끝 `>` 위치 (속성 안의 중괄호 식·문자열 고려). */
function tagEnd(src: string, lt: number): number {
  let brace = 0;
  let quote: string | null = null;
  for (let j = lt + 1; j < src.length; j++) {
    const c = src[j];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { if (brace === 0 || c === "`") quote = c; continue; }
    if (c === "{") brace++;
    else if (c === "}") brace--;
    else if (c === ">" && brace === 0) return j;
  }
  return src.length - 1;
}

interface Issue { line: number; tag: string }

/** 이름 없는 폼 컨트롤 목록. */
export function unlabeledControls(src: string): Issue[] {
  const issues: Issue[] = [];
  const htmlFors = new Set([...src.matchAll(/htmlFor=["{]+`?([^"}`]+)/g)].map((m) => m[1]));
  let labelDepth = 0;
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) break;
    const m = /^<(\/?)(label|FormField|input|select|textarea)\b/.exec(src.slice(lt, lt + 14));
    if (!m) { i = lt + 1; continue; }
    const end = tagEnd(src, lt);
    const tag = src.slice(lt, end + 1);
    const [, close, name] = m;
    if (name === "label" || name === "FormField") {
      if (close) labelDepth = Math.max(0, labelDepth - 1);
      else if (!tag.endsWith("/>")) labelDepth++;
    } else if (!close) {
      const type = /\btype=["{]+["`]?([a-z-]+)/.exec(tag)?.[1] ?? "";
      const skip = name === "input" && SKIP_INPUT_TYPES.has(type);
      const named = /\baria-label(ledby)?=|\btitle=/.test(tag);
      const id = /\bid=["{]+["`]?([^"}`]+)/.exec(tag)?.[1];
      const paired = id !== undefined && htmlFors.has(id);
      if (!skip && !named && labelDepth === 0 && !paired) {
        issues.push({ line: src.slice(0, lt).split("\n").length, tag: `<${name}${type ? ` type=${type}` : ""}>` });
      }
    }
    i = end + 1;
  }
  return issues;
}

/** 이름이 아니라 입력 예시인 정적 aria-label. */
const BAD_LABEL = /^(예[:)]|e\.g\.|[0-9\s./:-]+$|\/)/;
function exampleLabels(src: string): Issue[] {
  return [...src.matchAll(/<(input|select|textarea)\s+aria-label="([^"]*)"/g)]
    .filter((m) => m[2].trim() === "" || BAD_LABEL.test(m[2].trim()))
    .map((m) => ({ line: src.slice(0, m.index).split("\n").length, tag: `<${m[1]} aria-label="${m[2]}">` }));
}

test("스캐너 자체 점검: 이름 있는/없는 컨트롤을 구분한다", () => {
  assert.equal(unlabeledControls(`<label className="eyebrow">이름</label>\n<input value={x} />`).length, 1, "연결 안 된 형제 label 은 실패");
  assert.equal(unlabeledControls(`<label>이름 <input value={x} /></label>`).length, 0, "감싼 label 통과");
  assert.equal(unlabeledControls(`<FormField label="이름"><input value={x} /></FormField>`).length, 0, "FormField 통과");
  assert.equal(unlabeledControls(`<label htmlFor="nm">이름</label><input id="nm" />`).length, 0, "htmlFor/id 짝 통과");
  assert.equal(unlabeledControls(`<label htmlFor={\`f-\${k}\`}>이름</label><input id={\`f-\${k}\`} />`).length, 0, "템플릿 id 짝 통과");
  assert.equal(unlabeledControls(`<select aria-label={f.label} onChange={(e) => set({ a: e.target.value })}>`).length, 0, "동적 aria-label 통과");
  assert.equal(unlabeledControls(`<input type="checkbox" onChange={() => {}} />`).length, 0, "체크박스는 대상 아님");
  assert.equal(unlabeledControls(`<select onChange={(e) => { if (a > b) go(); }}>`).length, 1, "속성 식 안의 > 에 속지 않는다");
  assert.equal(exampleLabels(`<input aria-label="000000" />`).length, 1);
  assert.equal(exampleLabels(`<input aria-label="예: 2U" />`).length, 1);
  assert.equal(exampleLabels(`<input aria-label="/assets" />`).length, 1);
  assert.equal(exampleLabels(`<input aria-label="크기(U)" />`).length, 0);
});

test("모든 폼 컨트롤에 접근 가능한 이름이 있다 (KWCAG 레이블 제공)", () => {
  const bad: string[] = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8");
    for (const x of [...unlabeledControls(src), ...exampleLabels(src)]) bad.push(`${relative(SRC, file)}:${x.line} ${x.tag}`);
  }
  assert.deepEqual(bad, [], `이름 없는 폼 컨트롤 — aria-label 을 달거나 <label htmlFor> 로 연결하세요:\n${bad.join("\n")}`);
});

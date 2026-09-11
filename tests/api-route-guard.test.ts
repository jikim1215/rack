// tests/api-route-guard.test.ts — API 라우트 가드레일 (P1/P2/P3 회귀 방지)
// 모든 src/app/api/**/route.ts 의 **핸들러마다** (1) withApi 로 감싸이고, (2) 메뉴 인가(assertMenu*) 또는 assertAdmin 을 호출하며,
// (3) 호출한 메뉴 키가 그 경로에 귀속된 메뉴(menus.ts apiPrefixes)와 일치하고, (4) as any / authzError 보일러플레이트 / 우회 export 패턴이
// 없는지 소스 텍스트를 스캔해 확인한다. 새 라우트를 추가하면서 인가를 빼먹으면 이 테스트가 실패한다.
// (비평 반영: 파일 단위 → 핸들러 단위 검사, 재export/미래핑 화살표 핸들러 차단, 총괄 전용 경로는 assertAdmin 필수)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { MENUS, ADMIN_ONLY_API_PREFIXES, SESSION_ONLY_API_PREFIXES } from "../src/lib/menus.ts";

const API_ROOT = join(process.cwd(), "src", "app", "api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

/** 파일 경로 → URL 경로 (src/app/api/frames/[id]/route.ts → /api/frames/[id]) */
function urlPath(file: string): string {
  return "/api/" + relative(API_ROOT, file).split(sep).slice(0, -1).join("/");
}

const startsWithAny = (url: string, prefixes: readonly string[]) => prefixes.some((p) => url === p || url.startsWith(p + "/"));

/** 경로가 귀속되는 메뉴 키 (apiPrefixes 최장 일치). 없으면 null. */
function menuForPath(url: string): string | null {
  let best: { key: string; len: number } | null = null;
  for (const m of MENUS) {
    for (const p of m.apiPrefixes) {
      if ((url === p || url.startsWith(p + "/")) && (!best || p.length > best.len)) best = { key: m.key, len: p.length };
    }
  }
  return best?.key ?? null;
}

/** 소스에서 `export const <METHOD> = …` 로 시작하는 핸들러 청크를 잘라낸다. 청크는 다음 top-level 선언
 *  (export/function/const/let/type/interface 가 줄 첫머리에 오는 곳)에서 끝난다 — 마지막 핸들러 뒤의 모듈 헬퍼가 섞여 오탐 통과하지 않게. */
function handlerChunks(src: string): { method: string; body: string }[] {
  const re = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g;
  const marks: { method: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) marks.push({ method: m[1], start: m.index });
  const topLevel = /^(export\s+|async\s+function\s|function\s|const\s|let\s|type\s|interface\s)/gm;
  return marks.map((mk) => {
    topLevel.lastIndex = mk.start + 1;
    let end = src.length;
    let t: RegExpExecArray | null;
    while ((t = topLevel.exec(src))) { if (t.index > mk.start) { end = t.index; break; } }
    return { method: mk.method, body: src.slice(mk.start, end) };
  });
}

const files = walk(API_ROOT);

test("API 라우트 파일이 존재한다", () => {
  assert.ok(files.length >= 60, `라우트 ${files.length}개`);
});

for (const file of files) {
  const url = urlPath(file);
  const src = readFileSync(file, "utf8");
  const rel = relative(process.cwd(), file);

  test(`${url}: 핸들러별 withApi 래핑 + 인가 + 타입 (${rel})`, () => {
    // 우회 패턴 차단
    assert.ok(!/export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/.test(src), "export function 핸들러 — withApi 로 감싸야 함");
    assert.ok(!/export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE)\b/.test(src), "재export(export { x as GET }) 금지");
    assert.ok(!/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=(?!\s*withApi\()/.test(src), "withApi 없이 export 된 핸들러(화살표/식별자) 존재");
    assert.ok(!/authzError\(/.test(src), "authzError 보일러플레이트가 남아 있음");
    assert.ok(!/\bas any\b|:\s*any\b/.test(src), "`any` 가 남아 있음 — db-types 행 타입을 사용");
    assert.ok(!/\breq(uest)?\.json\(\)/.test(src), "req.json() 직접 호출 — readJson(req) 사용(JSON 파싱 오류만 400)");

    const chunks = handlerChunks(src);
    assert.ok(chunks.length > 0, "HTTP 핸들러가 없음");
    const exported = new Set(chunks.map((c) => c.method));
    for (const mth of METHODS) if (exported.has(mth)) assert.ok(chunks.some((c) => c.method === mth), `${mth} 청크 누락`);

    const expected = menuForPath(url);
    const adminOnly = startsWithAny(url, ADMIN_ONLY_API_PREFIXES);
    const sessionOnly = startsWithAny(url, SESSION_ONLY_API_PREFIXES);

    for (const c of chunks) {
      const label = `${c.method} ${url}`;
      assert.ok(/=\s*withApi\(/.test(c.body.slice(0, 200)), `${label}: withApi 로 감싸지 않음`);
      const usedMenuKeys = [...c.body.matchAll(/assertMenu(?:Access|Write|Approve)\(\s*actor\s*,\s*"([a-z_]+)"\s*\)/g)].map((x) => x[1]);
      const hasAdmin = /assertAdmin\(/.test(c.body);

      if (adminOnly) {
        assert.ok(hasAdmin, `${label}: 총괄 전용 경로는 모든 핸들러에서 assertAdmin 필수`);
        continue;
      }
      if (sessionOnly) {
        if (url.startsWith("/api/auth")) continue; // 인증 흐름 자체
        // /api/permissions: GET 은 전 역할(assertCanRead), 쓰기는 assertAdmin
        assert.ok(c.method === "GET" ? /assertCanRead\(/.test(c.body) || hasAdmin : hasAdmin, `${label}: 인가 호출 없음`);
        continue;
      }
      assert.ok(expected, `${label}: menus.ts apiPrefixes 에 귀속되지 않은 경로 — 레지스트리에 등록 필요`);
      assert.ok(usedMenuKeys.length > 0 || hasAdmin, `${label}: assertMenuAccess/Write/Approve(또는 assertAdmin) 호출이 없음`);
      for (const k of usedMenuKeys) {
        assert.equal(k, expected, `${label}: 메뉴 키 불일치 — 경로는 '${expected}' 인데 '${k}' 를 검사함`);
      }
      // 쓰기 메서드는 최소 assertMenuWrite 또는 assertAdmin (읽기 assert 만으로 쓰기 허용 금지)
      if (c.method !== "GET" && !hasAdmin) {
        assert.ok(/assertMenu(?:Write|Approve)\(/.test(c.body), `${label}: 쓰기 핸들러에 assertMenuWrite/Approve 없음`);
      }
    }
  });
}

test("menus.ts 레지스트리 정합성: 키/href/apiPrefixes 중복 없음, 3역할 기본값 존재, 총괄/세션 전용 접두사 형식", () => {
  const keys = MENUS.map((m) => m.key);
  assert.equal(new Set(keys).size, keys.length, "menu key 중복");
  const hrefs = MENUS.map((m) => m.href);
  assert.equal(new Set(hrefs).size, hrefs.length, "href 중복");
  const prefixes = MENUS.flatMap((m) => m.apiPrefixes);
  assert.equal(new Set(prefixes).size, prefixes.length, "apiPrefix 중복");
  for (const m of MENUS) {
    for (const role of ["admin", "team", "viewer"] as const) {
      const d = m.defaults[role];
      assert.equal(d.length, 3, `${m.key}/${role} defaults`);
      if (d[0] === 0) assert.ok(d[1] === 0 && d[2] === 0, `${m.key}/${role}: 접근 0 이면 쓰기/승인도 0`);
    }
    assert.deepEqual([...m.defaults.admin], [1, 1, 1], `${m.key}: admin 전부 허용`);
    if (m.adminOnly) {
      assert.deepEqual([...m.defaults.team], [0, 0, 0], `${m.key}: 총괄 전용 메뉴는 team 기본 0`);
      assert.deepEqual([...m.defaults.viewer], [0, 0, 0], `${m.key}: 총괄 전용 메뉴는 viewer 기본 0`);
    }
  }
  // 미들웨어와 이 테스트가 같은 배열을 쓰므로 여기서 정합성만 확인
  for (const p of ADMIN_ONLY_API_PREFIXES) assert.ok(p.startsWith("/api/"), `admin prefix 형식: ${p}`);
  for (const p of SESSION_ONLY_API_PREFIXES) assert.ok(!ADMIN_ONLY_API_PREFIXES.includes(p), `세션 전용과 총괄 전용이 겹침: ${p}`);
});

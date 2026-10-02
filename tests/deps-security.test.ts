// tests/deps-security.test.ts — 취약 버전 의존성이 lockfile 로 되돌아오지 않게 (폐쇄망이라 릴리스 후 자동 SCA 가 없다)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as { packages: Record<string, { version?: string }> };
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { overrides?: Record<string, string> };

const ver = (v: string) => v.split(".").map(Number);
const atLeast = (v: string, min: string) => {
  const [a, b] = [ver(v), ver(min)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

test("postcss: 설치되는 모든 사본이 8.5.28 이상 (next 15 내장 8.4.31 은 sourceMappingURL 임의 파일 읽기·XSS)", () => {
  // next 15 는 postcss 8.4.31 을 정확히 고정해 둔다. overrides 로 최상위 postcss 를 쓰게 하지 않으면 중첩 사본이 돌아온다.
  assert.equal(pkg.overrides?.postcss, "$postcss");
  const copies = Object.entries(lock.packages).filter(([path]) => path === "node_modules/postcss" || path.endsWith("/node_modules/postcss"));
  assert.ok(copies.length >= 1);
  for (const [path, info] of copies) assert.ok(atLeast(info.version ?? "0.0.0", "8.5.28"), `${path}@${info.version}`);
});

test("xlsx: 패치판 0.20.3 이상 (CVE-2023-30533 프로토타입 오염 · CVE-2024-22363 ReDoS)", () => {
  const x = lock.packages["node_modules/xlsx"];
  assert.ok(x?.version && atLeast(x.version, "0.20.3"), `xlsx@${x?.version}`);
});

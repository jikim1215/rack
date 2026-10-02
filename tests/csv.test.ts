// tests/csv.test.ts — CSV 내보내기 직렬화 (수식 주입 방지 · 따옴표 규칙 · 단일 정본)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { csvCell, toCsv, kstStamp } from "../src/lib/csv.ts";

test("수식으로 해석되는 첫 글자(=,+,-,@,TAB,CR)는 작은따옴표로 문자열 고정", () => {
  for (const payload of ['=HYPERLINK("http://x","클릭")', "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1", "=cmd|' /C calc'!A0"]) {
    const out = csvCell(payload);
    const unquoted = out.startsWith('"') ? out.slice(1, -1).replace(/""/g, '"') : out;
    assert.equal(unquoted[0], "'", `무력화 안 됨: ${JSON.stringify(payload)} → ${out}`);
    assert.equal(unquoted.slice(1), payload, "원래 값은 보존");
  }
});

test("평범한 값은 그대로, 구분자·따옴표·줄바꿈은 RFC 4180 따옴표 처리", () => {
  assert.equal(csvCell("웹서버-01"), "웹서버-01");
  assert.equal(csvCell("10.0.0.1"), "10.0.0.1");
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('그는 "예"'), '"그는 ""예"""');
  assert.equal(csvCell("1행\n2행"), '"1행\n2행"');
  assert.equal(csvCell("=a,b"), `"'=a,b"`, "수식 방지와 따옴표가 함께 적용");
  assert.equal(csvCell("값-1"), "값-1", "가운데 - 는 건드리지 않는다");
});

test("toCsv: BOM + CRLF, 행 단위 직렬화", () => {
  const out = toCsv([["id", "이름"], [1, "=x"], [2, "a,b"]]);
  assert.equal(out, "\uFEFFid,이름\r\n1,'=x\r\n2,\"a,b\"");
});

test("kstStamp: 서버 TZ 와 무관하게 KST 분 단위", () => {
  assert.equal(kstStamp(new Date("2026-10-01T15:04:59Z")), "20261002-0004");
  assert.equal(kstStamp(new Date("2026-12-31T14:59:00Z")), "20261231-2359");
});

test("CSV 를 직접 이어 붙이는 코드가 없다 — 내보내기는 src/lib/csv.ts 만 쓴다", () => {
  const SRC = join(process.cwd(), "src");
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n) && !p.endsWith(join("lib", "csv.ts"))) {
        const s = readFileSync(p, "utf8");
        // BOM 을 손으로 붙이거나 text/csv 를 만들면서 csv 모듈을 쓰지 않는 파일
        if ((/"\\uFEFF"/.test(s) || /text\/csv/.test(s)) && !/from "@\/lib\/csv"/.test(s)) hits.push(relative(SRC, p));
      }
    }
  };
  walk(SRC);
  assert.deepEqual(hits, []);
});

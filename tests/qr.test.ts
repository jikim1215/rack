// tests/qr.test.ts — QR 인코더 (ISO 18004 바이트 모드)
// 골든 해시는 jsqr(실제 디코더)로 60개 케이스(버전 1~40, L/M, 한글, 용량 경계)를 디코드해 원문 일치를
// 확인한 뒤 동결한 값이다. 인코더를 바꾸면 반드시 디코더로 재검증하고 갱신할 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodeQr, qrSvgPath, ecBlocks, minVersionFor, formatBits, versionBits, TOTAL_CODEWORDS } from "../src/lib/qr.ts";
import { otpauthUri, generateSecret } from "../src/lib/totp.ts";

const hashOf = (modules: boolean[][]) =>
  createHash("sha256").update(modules.map((r) => r.map((b) => (b ? "1" : "0")).join("")).join("\n")).digest("hex").slice(0, 16);

test("EC 블록 테이블: 80행(버전 1~40 × L/M) 전부 총 코드워드가 표준값과 일치", () => {
  for (const level of ["L", "M"] as const) for (let v = 1; v <= 40; v++) {
    assert.equal(ecBlocks(v, level).totalCodewords, TOTAL_CODEWORDS[v], `v${v}${level}`);
  }
});

test("EC 블록 테이블: 데이터 용량은 버전이 오를수록 단조 증가", () => {
  for (const level of ["L", "M"] as const) {
    let prev = 0;
    for (let v = 1; v <= 40; v++) {
      const d = ecBlocks(v, level).dataCodewords;
      assert.ok(d > prev, `v${v}${level}: ${d} <= ${prev}`);
      prev = d;
    }
  }
});

test("포맷 정보 BCH: 알려진 값 (M/mask0 = 0x5412, L/mask0 = 0x77C4)", () => {
  assert.equal(formatBits("M", 0), 0x5412);
  assert.equal(formatBits("L", 0), 0x77c4);
  // 15비트 범위
  for (const l of ["L", "M"] as const) for (let m = 0; m < 8; m++) assert.ok(formatBits(l, m) < 1 << 15);
});

test("버전 정보 BCH: v7 = 0x07C94, v40 = 0x28C69", () => {
  assert.equal(versionBits(7), 0x07c94);
  assert.equal(versionBits(40), 0x28c69);
});

test("최소 버전 선택: 문자수 지시자 8→16비트 경계(v9/v10)", () => {
  // v9-M 데이터 코드워드 182 → (182*8 - 4 - 8)/8 = 180 바이트가 최대
  assert.equal(minVersionFor(180, "M"), 9);
  assert.equal(minVersionFor(181, "M"), 10);
  assert.equal(minVersionFor(0, "L"), 1);
  assert.equal(minVersionFor(3000, "L"), -1, "40 버전 초과");
});

test("골든: 디코더 검증 완료된 출력과 비트 단위 일치", () => {
  const cases: [string, "L" | "M", number, number, number, string][] = [
    ["HELLO WORLD", "M", 1, 4, 21, "2d21897bf5a7ac60"],
    ["otpauth://totp/ITAM:admin@example.go.kr?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=ITAM&algorithm=SHA1&digits=6&period=30", "M", 8, 4, 49, "63d529b598048a6b"],
    ["한글 테스트 ✓", "L", 2, 5, 25, "2ff6055f51614ffb"],
  ];
  for (const [text, level, version, mask, size, hash] of cases) {
    const qr = encodeQr(text, level);
    assert.equal(qr.version, version, `${text.slice(0, 20)} version`);
    assert.equal(qr.mask, mask, `${text.slice(0, 20)} mask`);
    assert.equal(qr.size, size);
    assert.equal(hashOf(qr.modules), hash, `${text.slice(0, 20)} 행렬 불일치 — 인코더 변경 시 디코더로 재검증 필요`);
  }
});

test("구조 불변식: 파인더 3개·타이밍·다크 모듈·크기", () => {
  const qr = encodeQr(otpauthUri(generateSecret(), "user@example.go.kr"));
  const m = qr.modules, n = qr.size;
  assert.equal(n, qr.version * 4 + 17);
  // 파인더 중심(3,3),(n-4,3),(3,n-4) 은 어둡고 그 링(거리2)은 밝다
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    assert.equal(m[cy][cx], true);
    assert.equal(m[cy - 2][cx], false);
    assert.equal(m[cy][cx + 2], false);
  }
  // 타이밍 패턴: 6행/6열 8..n-9 구간이 교대
  for (let i = 8; i < n - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, `timing row ${i}`);
    assert.equal(m[i][6], i % 2 === 0, `timing col ${i}`);
  }
  // 다크 모듈 (8, n-8)
  assert.equal(m[n - 8][8], true);
});

test("실제 otpauth URI(한글 issuer 포함)가 40 버전 안에 들어가고 결정적", () => {
  const uri = otpauthUri("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", "admin@example.go.kr");
  const a = encodeQr(uri), b = encodeQr(uri);
  assert.ok(a.version >= 7 && a.version <= 15, `예상 밖 버전 ${a.version}`);
  assert.equal(hashOf(a.modules), hashOf(b.modules), "같은 입력은 같은 출력");
});

test("SVG path: quiet zone 포함 viewBox, 어두운 모듈 수만큼 h 세그먼트 합", () => {
  const qr = encodeQr("ABC");
  const { path, viewBox } = qrSvgPath(qr, 4);
  assert.equal(viewBox, qr.size + 8);
  const darkCount = qr.modules.flat().filter(Boolean).length;
  const segSum = [...path.matchAll(/h(\d+)v1/g)].reduce((s, m) => s + Number(m[1]), 0);
  assert.equal(segSum, darkCount);
  assert.ok(path.startsWith("M"));
});

test("용량 초과는 오류", () => {
  assert.throws(() => encodeQr("x".repeat(3000), "L"), /용량 초과/);
});

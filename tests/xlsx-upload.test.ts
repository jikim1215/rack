// 엑셀 업로드 공통 입구(lib/xlsx-upload.ts) + 압축 폭탄 차단(assertXlsxExpansion).
// 폭탄은 zip 을 직접 조립해 만든다 — 중앙 디렉터리의 "선언 크기"를 속여도 실제로 풀어 보고 막는지가 핵심.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import { assertXlsxExpansion, UPLOAD_MAX_ROWS, UPLOAD_MAX_UNZIPPED_BYTES } from "../src/lib/validation/upload.ts";
import { ValidationError } from "../src/lib/validation/input.ts";
import { parseUploadBuffer, readUploadSheet } from "../src/lib/xlsx-upload.ts";

interface Entry { name: string; data: Buffer; store?: boolean; declaredSize?: number; encrypted?: boolean }

/** 최소 zip 조립기(로컬 헤더 + 중앙 디렉터리 + EOCD). CRC 는 검사 대상이 아니므로 0. */
function zip(entries: Entry[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.store ? e.data : deflateRawSync(e.data);
    const name = Buffer.from(e.name);
    const usz = e.declaredSize ?? e.data.length;
    const flags = e.encrypted ? 1 : 0, method = e.store ? 0 : 8;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(usz, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(usz, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function workbook(aoa: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "s");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

const MB = 1024 * 1024;
const rejects = (fn: () => unknown, re: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof ValidationError && re.test(e.message));

test("정상 xlsx: 통과하고 첫 시트를 2차원 배열로 (defval·blankrows 옵션 반영)", () => {
  const buf = workbook([["자산명", "IP"], ["web-01", "10.0.0.1"], [], ["db-01"]]);
  const info = assertXlsxExpansion(buf);
  assert.ok(info.entries > 0 && info.unzippedBytes > 0 && info.unzippedBytes < MB);
  assert.deepEqual(parseUploadBuffer(buf, { blankrows: false }), [["자산명", "IP"], ["web-01", "10.0.0.1"], ["db-01"]]);
  assert.deepEqual(parseUploadBuffer(buf, { defval: "", blankrows: false })[2], ["db-01", ""]);
});

test("dense 파싱(메모리 절감)은 기존 sparse 파싱과 결과가 같다 — 병합·날짜·빈 셀·빈 행", () => {
  const ws = XLSX.utils.aoa_to_sheet([["배선반명", "페어", "날짜", "비고"], ["MDF-1", 1, new Date(Date.UTC(2024, 2, 5)), ""], [], [null, 2, null, "끝"]], { cellDates: true });
  ws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "s");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  for (const cellDates of [false, true]) for (const o of [{ defval: "" }, { blankrows: false }, {}]) {
    const sparse = XLSX.read(buf, { type: "buffer", cellDates });
    const expected = XLSX.utils.sheet_to_json(sparse.Sheets[sparse.SheetNames[0]], { header: 1, ...o });
    assert.deepEqual(parseUploadBuffer(buf, { cellDates, ...o }), expected, JSON.stringify({ cellDates, o }));
  }
});

test("압축 폭탄: 0 으로 채운 엔트리는 상한에서 끊고 400 (수 KB 짜리 파일이 수십 MB 로 풀림)", () => {
  const bomb = zip([{ name: "[Content_Types].xml", data: Buffer.from("<Types/>") }, { name: "xl/worksheets/sheet1.xml", data: Buffer.alloc(UPLOAD_MAX_UNZIPPED_BYTES + MB) }]);
  assert.ok(bomb.length < 200 * 1024, `폭탄 파일 크기 ${bomb.length}`); // 크기 상한(20MB)은 통과하는 크기
  rejects(() => assertXlsxExpansion(bomb), /압축을 풀면 너무 큰/);
  rejects(() => parseUploadBuffer(bomb), /압축을 풀면 너무 큰/);
});

test("압축 폭탄: 중앙 디렉터리의 선언 크기를 작게 속여도 실제 해제량으로 차단", () => {
  const liar = zip([{ name: "a.xml", data: Buffer.alloc(3 * MB), declaredSize: 10 }]);
  rejects(() => assertXlsxExpansion(liar, 2 * MB), /압축을 풀면 너무 큰/);
  assert.equal(assertXlsxExpansion(liar, 4 * MB).unzippedBytes, 3 * MB); // 선언값(10)이 아닌 실제 크기
});

test("압축 폭탄: 엔트리 각각은 작아도 누적 합이 상한을 넘으면 차단 (경계값 포함)", () => {
  const parts = [0, 1, 2].map((i) => ({ name: `p${i}.xml`, data: Buffer.alloc(MB) }));
  assert.equal(assertXlsxExpansion(zip(parts), 3 * MB).unzippedBytes, 3 * MB); // 정확히 상한 = 통과
  rejects(() => assertXlsxExpansion(zip(parts), 3 * MB - 1), /압축을 풀면 너무 큰/);
  rejects(() => assertXlsxExpansion(zip([{ name: "s.bin", data: Buffer.alloc(3 * MB), store: true }]), 2 * MB), /압축을 풀면 너무 큰/);
});

test("손상·위장·암호화 zip 은 500 이 아니라 400", () => {
  const good = workbook([["a"], ["b"]]);
  rejects(() => parseUploadBuffer(Buffer.from("이건 엑셀이 아니다")), /매직바이트/);
  rejects(() => parseUploadBuffer(good.subarray(0, good.length - 40)), /유효한 \.xlsx/);       // EOCD 잘림
  rejects(() => parseUploadBuffer(Buffer.concat([good.subarray(0, 4), Buffer.alloc(200, 0x41)])), /유효한 \.xlsx/); // PK 만 맞춘 위장
  const broken = Buffer.from(good); broken.fill(0x41, 40, 400);                                  // 압축 스트림 훼손
  rejects(() => parseUploadBuffer(broken), /유효한 \.xlsx|읽지 못했/);
  rejects(() => assertXlsxExpansion(zip([{ name: "a.xml", data: Buffer.from("x"), encrypted: true }])), /유효한 \.xlsx/);
  // zip 은 정상인데 엑셀 구조가 아님 → 시트 0개는 빈 배열, 예외면 400
  try { assert.deepEqual(parseUploadBuffer(zip([{ name: "hello.txt", data: Buffer.from("hi") }])), []); }
  catch (e) { assert.ok(e instanceof ValidationError); }
});

test("행 상한: 헤더 제외 UPLOAD_MAX_ROWS 까지 통과, 1행 초과 거부", () => {
  const rows = (n: number) => [["h"], ...Array.from({ length: n }, (_, i) => [i])];
  assert.equal(parseUploadBuffer(workbook(rows(UPLOAD_MAX_ROWS))).length, UPLOAD_MAX_ROWS + 1);
  rejects(() => parseUploadBuffer(workbook(rows(UPLOAD_MAX_ROWS + 1))), /최대/);
});

test("업로드 UI 파일 선택기는 .xlsx 만 (서버가 .xls 를 거부하므로 고를 수 있게 두지 않는다)", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const files = readdirSync(new URL("../src/", import.meta.url), { recursive: true }).map(String).filter((f) => f.endsWith(".tsx"));
  const inputs = files.flatMap((f) => [...readFileSync(new URL("../src/" + f.replace(/\\/g, "/"), import.meta.url), "utf8").matchAll(/accept="([^"]*xls[^"]*)"/g)].map((m) => `${f}: ${m[1]}`));
  assert.ok(inputs.length >= 5, `엑셀 업로드 입력 ${inputs.length}개`);
  assert.deepEqual(inputs.filter((s) => !s.endsWith(": .xlsx")), []);
});

test("readUploadSheet: File 경로도 크기 상한부터 (없음/빈 파일 400)", async () => {
  await assert.rejects(readUploadSheet(null), ValidationError);
  await assert.rejects(readUploadSheet(new File([], "a.xlsx")), ValidationError);
  assert.deepEqual(await readUploadSheet(new File([new Uint8Array(workbook([["x"], [1]]))], "a.xlsx")), [["x"], [1]]);
});

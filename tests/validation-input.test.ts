// tests/validation-input.test.ts — 쓰기 API 입력 검증 헬퍼(P2) + 자산 본문 파서
import { test } from "node:test";
import assert from "node:assert/strict";
import { asBody, str, oneOf, int, idOrNull, flag, dateStr, normalizeDate, pathId, ValidationError } from "../src/lib/validation/input.ts";
import { parseAssetBody } from "../src/lib/validation/asset-input.ts";
import { validateAssetRow } from "../src/lib/validation/asset-rules.ts";

const throwsV = (fn: () => unknown, re?: RegExp) => assert.throws(fn, (e: unknown) => e instanceof ValidationError && (!re || re.test((e as Error).message)));

test("asBody: 객체만 허용", () => {
  assert.deepEqual(asBody({ a: 1 }), { a: 1 });
  throwsV(() => asBody(null));
  throwsV(() => asBody([1]));
  throwsV(() => asBody("x"));
});

test("str: trim/기본값/필수/길이", () => {
  assert.equal(str({ n: "  a " }, "n"), "a");
  assert.equal(str({}, "n"), "");
  assert.equal(str({}, "n", { default: "z" }), "z");
  throwsV(() => str({ n: "  " }, "n", { required: true, label: "이름" }), /이름/);
  throwsV(() => str({ n: "x".repeat(11) }, "n", { max: 10 }), /10자/);
  assert.equal(str({ n: 123 }, "n"), "123", "숫자는 문자열로");
});

test("oneOf: enum 강제 + 기본값 + 허용값 안내", () => {
  const allowed = ["a", "b"] as const;
  assert.equal(oneOf({ k: "b" }, "k", allowed), "b");
  assert.equal(oneOf({}, "k", allowed, { default: "a" }), "a");
  throwsV(() => oneOf({ k: "c" }, "k", allowed, { label: "상태" }), /상태.*허용: a, b/);
  throwsV(() => oneOf({}, "k", allowed, { required: true }));
  throwsV(() => oneOf({ k: "" }, "k", allowed));
});

test("int/idOrNull: 정수·범위·null 처리", () => {
  assert.equal(int({ n: "42" }, "n"), 42);
  assert.equal(int({ n: 7 }, "n", { min: 1, max: 10 }), 7);
  assert.equal(int({}, "n"), null);
  assert.equal(int({}, "n", { default: 3 }), 3);
  throwsV(() => int({ n: "1.5" }, "n"), /정수/);
  throwsV(() => int({ n: 0 }, "n", { min: 1 }), /1 이상/);
  throwsV(() => int({}, "n", { required: true, label: "수량" }), /수량/);
  assert.equal(idOrNull({ id: 0 }, "id"), null);
  assert.equal(idOrNull({ id: "" }, "id"), null);
  assert.equal(idOrNull({ id: "5" }, "id"), 5);
  throwsV(() => idOrNull({ id: -1 }, "id"));
});

test("flag: 0/1 정규화", () => {
  assert.equal(flag({ f: true }, "f"), 1);
  assert.equal(flag({ f: "0" }, "f"), 0);
  assert.equal(flag({}, "f", 1), 1);
  throwsV(() => flag({ f: "yes" }, "f"));
});

test("dateStr/normalizeDate: 표준·레거시 표기 정규화, 해석 불가는 400", () => {
  assert.equal(dateStr({ d: "2026-09-11" }, "d"), "2026-09-11");
  assert.equal(dateStr({}, "d"), "");
  // 엑셀 임포트 레거시 표기 (비평 반영: 임포트 자산 편집 불가 회귀 방지)
  assert.equal(normalizeDate("2026/09/11"), "2026-09-11");
  assert.equal(normalizeDate("2026.9.1"), "2026-09-01");
  assert.equal(normalizeDate("20260911"), "2026-09-11");
  assert.equal(normalizeDate("2026-09-11 00:00:00"), "2026-09-11");
  assert.equal(normalizeDate("2026-09-11T09:00:00Z"), "2026-09-11");
  assert.equal(normalizeDate(45123), "2023-07-16", "엑셀 일련번호");
  assert.equal(normalizeDate("45123"), "2023-07-16");
  assert.equal(normalizeDate(new Date(Date.UTC(2024, 1, 29))), "2024-02-29");
  assert.equal(normalizeDate(""), "");
  assert.equal(normalizeDate(null), "");
  for (const bad of ["abc", "2026-13-01", "2026-02-30", "미상", "99", "11/09/2026"]) {
    assert.equal(normalizeDate(bad), null, `해석 불가: ${bad}`);
  }
  throwsV(() => dateStr({ d: "미상" }, "d", { label: "구매일" }), /구매일.*YYYY-MM-DD.*미상/);
});

test("pathId: 양의 정수만", () => {
  assert.equal(pathId("12"), 12);
  throwsV(() => pathId("abc"));
  throwsV(() => pathId("0"));
  throwsV(() => pathId("-3"));
});

test("parseAssetBody: 정상 본문 정규화 (name 별칭·IP 목록·CIA·랙)", () => {
  const p = parseAssetBody({
    asset_type: "server", name: "SRV-01", status: "standby", rack_id: "3", rack_unit_start: "10", rack_side: "L",
    cia_c: "3", cia_i: "", ips: [{ ip_address: "10.0.0.1", is_primary: true }, { ip_address: "" }],
    custom_values: { "7": "x" }, team_id: "2",
  });
  assert.equal(p.columns.asset_name, "SRV-01");
  assert.equal(p.columns.status, "standby");
  assert.equal(p.columns.rack_id, 3);
  assert.equal(p.columns.rack_unit_start, 10);
  assert.equal(p.columns.rack_side, "L");
  assert.equal(p.columns.rack_unit_size, 1);
  assert.equal(p.columns.cia_c, 3);
  assert.equal(p.columns.cia_i, null);
  assert.equal(p.ips.length, 1, "빈 IP 는 제거");
  assert.equal(p.ips[0].ip_type, "service");
  assert.equal(p.ipsProvided, true);
  assert.deepEqual(p.customValues, { "7": "x" });
});

test("parseAssetBody: PUT 에서 건드리지 않은 레거시 날짜는 그대로 통과, 바꾸면 검사", () => {
  const existing = { purchase_date: "미상", warranty_date: "", eos_date: "2027-01-01" };
  const p = parseAssetBody({ asset_type: "server", asset_name: "x", purchase_date: "미상", eos_date: "2027-01-01" }, existing);
  assert.equal(p.columns.purchase_date, "미상", "미변경 레거시 값 보존");
  throwsV(() => parseAssetBody({ asset_type: "server", asset_name: "x", purchase_date: "알수없음" }, existing), /구매일/);
  assert.equal(parseAssetBody({ asset_type: "server", asset_name: "x", purchase_date: "2024.03.01" }, existing).columns.purchase_date, "2024-03-01");
});

test("parseAssetBody: 랙 없으면 rack_side/unit 무시, ips 없으면 ipsProvided=false", () => {
  const p = parseAssetBody({ asset_type: "vm", asset_name: "v", rack_side: "R", rack_unit_start: 5 });
  assert.equal(p.columns.rack_id, null);
  assert.equal(p.columns.rack_side, null);
  assert.equal(p.columns.rack_unit_start, null);
  assert.equal(p.ipsProvided, false);
});

test("parseAssetBody: 잘못된 status/CIA/날짜/필수 누락은 400 ValidationError", () => {
  throwsV(() => parseAssetBody({ asset_type: "server", asset_name: "x", status: "eos" }), /상태/);
  throwsV(() => parseAssetBody({ asset_type: "server", asset_name: "x", cia_c: 9 }), /CIA_C/);
  throwsV(() => parseAssetBody({ asset_type: "server", asset_name: "x", purchase_date: "미상" }), /구매일/);
  // 레거시 표기는 정규화되어 통과
  assert.equal(parseAssetBody({ asset_type: "server", asset_name: "x", purchase_date: "2026.01.01" }).columns.purchase_date, "2026-01-01");
  throwsV(() => parseAssetBody({ asset_type: "", asset_name: "x" }), /자산 유형/);
  throwsV(() => parseAssetBody({ asset_type: "server" }), /자산명/);
  throwsV(() => parseAssetBody({ asset_type: "server", asset_name: "x", ips: [{ ip_address: "1.1.1.1", ip_type: "weird" }] }), /IP 유형/);
});

test("validateAssetRow(임포트): 레거시 날짜는 정규화, 해석 불가는 '' + date_format 이슈로 원본 보존", () => {
  const ok = validateAssetRow({ asset_type: "server", asset_name: "s", ip_address: "10.0.0.1", os: "linux", purchase_date: "2023.01.05", eos_date: 45123 });
  assert.equal(ok.asset.purchase_date, "2023-01-05");
  assert.equal(ok.asset.eos_date, "2023-07-16");
  assert.ok(!ok.issues.some((i) => i.issue_type === "date_format"));
  const bad = validateAssetRow({ asset_type: "server", asset_name: "s", ip_address: "10.0.0.1", os: "linux", warranty_date: "미상" });
  assert.equal(bad.asset.warranty_date, "");
  const iss = bad.issues.find((i) => i.issue_type === "date_format");
  assert.ok(iss && iss.raw_value === "미상" && /보증만료일/.test(iss.note), JSON.stringify(bad.issues));
});


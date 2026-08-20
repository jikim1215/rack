import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSubAssetRows,
  cellToText,
  parseStatus,
  buildSubAssetWorkbook,
  SUBASSET_HEADERS,
} from "../src/lib/subasset-import.ts";
import * as XLSX from "xlsx";

const HEADER = SUBASSET_HEADERS.map(([label]) => label);
// [자산코드,대분류,중분류,소분류,자산명,규격,시리얼번호,취득일,사용자,설치장소,용도,비고,상태,상위장비,관리부서]

test("cellToText: Date→YYYY-MM-DD, 숫자→문자열, 트림, null→''", () => {
  assert.equal(cellToText(new Date(2024, 0, 5)), "2024-01-05");
  assert.equal(cellToText(32), "32");
  assert.equal(cellToText("  V3 백신  "), "V3 백신");
  assert.equal(cellToText(null), "");
});

test("parseStatus: 폐기/disposed만 disposed, 그 외(공란 포함) active", () => {
  assert.equal(parseStatus("폐기"), "disposed");
  assert.equal(parseStatus("disposed"), "disposed");
  assert.equal(parseStatus("운용중"), "active");
  assert.equal(parseStatus(""), "active");
  assert.equal(parseStatus(null), "active");
});

test("parseSubAssetRows: 헤더 라벨 → 필드 매핑 + 상태 정규화", () => {
  const row = ["SW-2026-001", "부속자산", "소프트웨어", "백신", "V3 라이선스", "100노드", "SN-1", new Date(2024, 2, 1), "김정보", "전산실 A01", "백신 운영", "연1갱신", "운용중", "웹서버-01", "정보운영과"];
  const { subs, skipped } = parseSubAssetRows([HEADER, row]);
  assert.equal(skipped, 0);
  assert.equal(subs.length, 1);
  const s = subs[0];
  assert.equal(s.asset_code, "SW-2026-001");
  assert.equal(s.category_mid, "소프트웨어");
  assert.equal(s.category_minor, "백신");
  assert.equal(s.sub_name, "V3 라이선스");
  assert.equal(s.spec, "100노드");
  assert.equal(s.acquired_date, "2024-03-01");
  assert.equal(s.place, "전산실 A01");
  assert.equal(s.status, "active");
  assert.equal(s.parent_name, "웹서버-01");
  assert.equal(s.team_name, "정보운영과");
});

test("parseSubAssetRows: 자산명·자산코드 모두 공란 행은 스킵, 완전 빈 행은 무시", () => {
  const good = ["C-1", "", "", "", "메모리 32GB", "", "", "", "", "", "", "", "", "", ""];
  const emptyRow = new Array(HEADER.length).fill("");
  const noId = new Array(HEADER.length).fill("");
  noId[5] = "규격만 있음"; // 자산명·자산코드 없음
  const { subs, skipped } = parseSubAssetRows([HEADER, good, emptyRow, noId]);
  assert.equal(subs.length, 1);
  assert.equal(skipped, 1); // noId만 스킵(빈 행은 무시)
});

test("parseSubAssetRows: 자산코드만 있고 자산명 공란이어도 채택(폐기 상태)", () => {
  const row = new Array(HEADER.length).fill("");
  row[0] = "HW-9"; // 자산코드
  row[12] = "폐기"; // 상태
  const { subs, skipped } = parseSubAssetRows([HEADER, row]);
  assert.equal(subs.length, 1);
  assert.equal(skipped, 0);
  assert.equal(subs[0].asset_code, "HW-9");
  assert.equal(subs[0].status, "disposed");
});

test("buildSubAssetWorkbook → parseSubAssetRows 라운드트립(핵심 필드 + 상태 라벨 보존)", () => {
  const records = [
    { asset_code: "SW-1", category_mid: "소프트웨어", category_minor: "OS", sub_name: "RHEL 구독", spec: "10소켓", serial_number: "", acquired_date: "2023-05-10", user_name: "박관리", place: "IDC-2", purpose: "서버 OS", note: "", status: "active", parent_name: "DB서버-02", team_name: "인프라팀" },
    { asset_code: "HW-2", category_mid: "메모리", category_minor: "DDR4", sub_name: "32GB ECC", spec: "32GB", serial_number: "M-77", acquired_date: "", user_name: "", place: "창고", purpose: "", note: "여유분", status: "disposed", parent_name: "", team_name: "" },
  ];
  const buf = buildSubAssetWorkbook(records);
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  const { subs } = parseSubAssetRows(rows);

  assert.equal(subs.length, 2);
  assert.equal(subs[0].asset_code, "SW-1");
  assert.equal(subs[0].sub_name, "RHEL 구독");
  assert.equal(subs[0].acquired_date, "2023-05-10");
  assert.equal(subs[0].parent_name, "DB서버-02");
  assert.equal(subs[0].team_name, "인프라팀");
  assert.equal(subs[0].status, "active");
  assert.equal(subs[1].asset_code, "HW-2");
  assert.equal(subs[1].sub_name, "32GB ECC");
  assert.equal(subs[1].status, "disposed"); // '폐기' 라벨 왕복
  assert.equal(subs[1].note, "여유분");
});

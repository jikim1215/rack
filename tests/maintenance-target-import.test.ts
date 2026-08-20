import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTargetRows, cellToText, buildTargetWorkbook } from "../src/lib/maintenance-target-import.ts";
import * as XLSX from "xlsx";

// 엑셀 원본 헤더(일부 빈/분리 컬럼 포함)를 재현
const HEADER = [
  "No.", "정보시스템명", "구분", "유형", "정보자원명", "수량", "제조사", "호스트명", "용도",
  "지역(동)", "건물명", "층", "랙위치", "자산코드", "", "자산사용부서", "자산사용자",
  "자산취득일자", "내용년수", "자산취득금액", "담당자", "", "담당부서", "",
  "취득일자", "도입금액", "유지보수시작", "유지보수종료", "기간",
  "업무영향범위", "데이터중요도", "이용자수/처리건수", "H/W", "유지보수난이도", "유지보수항목",
  "측정점수", "유지관리등급", "유지관리요율", "추정금액(계산)", "추정금액(입력)", "근거자료", "비고",
];

function rowFrom(overrides: Record<number, unknown> = {}): unknown[] {
  const row = new Array(HEADER.length).fill("");
  // 1행 실제 예시 값
  row[0] = 1; row[1] = "공용센터"; row[2] = "서버"; row[3] = "IBM"; row[4] = "IBM X3650";
  row[5] = 1; row[6] = "IBM"; row[7] = "NMS"; row[8] = "인터넷망 NMS";
  row[9] = "본원"; row[10] = "전산실"; row[11] = 2; row[12] = ""; row[13] = "ASSET-0001";
  row[15] = "운영팀"; row[16] = "홍길동";
  row[24] = new Date(2011, 11, 30); row[25] = 18666668;
  row[26] = new Date(2025, 0, 1); row[27] = new Date(2025, 11, 31); row[28] = 12;
  row[29] = 40; row[30] = 4; row[31] = 5; row[32] = 90; row[33] = 60; row[34] = 25;
  row[35] = 72; row[36] = 4; row[37] = 7; row[38] = 1306667; row[39] = 1306667;
  for (const [k, v] of Object.entries(overrides)) row[Number(k)] = v;
  return row;
}

test("cellToText: Date→YYYY-MM-DD, 숫자→문자열, 트림", () => {
  assert.equal(cellToText(new Date(2025, 0, 1)), "2025-01-01");
  assert.equal(cellToText(18666668), "18666668");
  assert.equal(cellToText("  값  "), "값");
  assert.equal(cellToText(null), "");
});

test("parseTargetRows: 엑셀 라벨을 필드로 매핑하고 위치를 합성한다", () => {
  const { targets, skipped } = parseTargetRows([HEADER, rowFrom()]);
  assert.equal(skipped, 0);
  assert.equal(targets.length, 1);
  const t = targets[0];
  assert.equal(t.system_name, "공용센터");
  assert.equal(t.category, "서버");
  assert.equal(t.resource_name, "IBM X3650");
  assert.equal(t.quantity, 1);
  assert.equal(t.asset_code, "ASSET-0001");
  assert.equal(t.owner_department, "운영팀");
  assert.equal(t.owner_user, "홍길동");
  assert.equal(t.location_text, "본원 / 전산실 / 2");
  assert.equal(t.acquisition_date, "2011-12-30");
  assert.equal(t.acquisition_amount, "18666668");
  assert.equal(t.maintenance_start, "2025-01-01");
  assert.equal(t.maintenance_end, "2025-12-31");
  assert.equal(t.maintenance_months, 12);
  assert.equal(t.hardware_score, "90");
  assert.equal(t.score_total, "72");
  assert.equal(t.grade, "4");
  assert.equal(t.rate, "7");
  assert.equal(t.estimated_amount_input, "1306667");
});

test("parseTargetRows: 핵심 식별자 없는 행은 스킵, 완전 빈 행은 무시", () => {
  const emptyRow = new Array(HEADER.length).fill("");
  const onlyNo = new Array(HEADER.length).fill("");
  onlyNo[0] = 99; // No만 있고 자원명/코드/시스템명 없음
  const { targets, skipped } = parseTargetRows([HEADER, rowFrom(), emptyRow, onlyNo]);
  assert.equal(targets.length, 1);
  assert.equal(skipped, 1); // onlyNo만 스킵(빈 행은 무시로 카운트 안 함)
});

test("buildTargetWorkbook → parseTargetRows 라운드트립(핵심 필드 보존)", () => {
  const rec = {
    system_name: "공용센터", category: "네트워크", resource_name: "Cisco ASR1002",
    asset_code: "ASSET-0002", quantity: 1, location_text: "본원 / 공용센터 / 2",
    maintenance_start: "2025-01-01", maintenance_end: "2025-12-31", maintenance_months: 12,
    grade: "3", rate: "8", estimated_amount_input: "1619200", owner_department: "운영팀",
  };
  const buf = buildTargetWorkbook([rec]);

  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  const { targets } = parseTargetRows(rows);
  assert.equal(targets.length, 1);
  const t = targets[0];
  assert.equal(t.system_name, "공용센터");
  assert.equal(t.resource_name, "Cisco ASR1002");
  assert.equal(t.asset_code, "ASSET-0002");
  assert.equal(t.location_text, "본원 / 공용센터 / 2");
  assert.equal(t.estimated_amount_input, "1619200");
  assert.equal(t.grade, "3");
});

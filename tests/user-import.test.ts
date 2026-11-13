// tests/user-import.test.ts — 사용자 계정 엑셀 일괄 등록: 행 검증 + 양식 왕복
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateUserRows, buildUserImportTemplate, USER_IMPORT_HEADERS, USER_IMPORT_MAX_ROWS } from "../src/lib/user-import.ts";
import { parseUploadBuffer } from "../src/lib/xlsx-upload.ts";

const ctx = {
  existingUsernames: new Set(["taken@example.go.kr"]),
  teams: [{ id: 7, team_name: "정보운영팀" }, { id: 9, team_name: "보안팀" }],
};
const H = [...USER_IMPORT_HEADERS];

test("정상 행: 이메일 정규화, 역할 별칭, 팀 이름→id, 허용IP 정규화, 역할 공란=팀", () => {
  const { users, errors } = validateUserRows([
    H,
    [" Hong@Example.go.kr ", "홍길동", "팀", "정보운영팀", "10.20.30.0/24, 10.20.31.5"],
    ["kim@example.go.kr", "김열람", "전체열람", "", ""],
    ["lee@example.go.kr", "", "", "보안팀", ""],
  ], ctx);
  assert.deepEqual(errors, []);
  assert.deepEqual(users.map((u) => [u.row, u.username, u.role, u.team_id, u.allowed_ips]), [
    [2, "hong@example.go.kr", "team", 7, "10.20.30.0/24,10.20.31.5"],
    [3, "kim@example.go.kr", "viewer", null, ""],
    [4, "lee@example.go.kr", "team", 9, ""],
  ]);
});

test("오류 행: 행 번호(엑셀 기준)와 사유를 모두 모은다 — 빈 행은 건너뛰되 번호는 유지", () => {
  const { users, errors } = validateUserRows([
    H,
    ["bad-email", "", "팀", "정보운영팀", ""],
    ["taken@example.go.kr", "", "팀", "정보운영팀", ""],
    [null, null, null, null, null],
    ["boss@example.go.kr", "", "총괄", "", ""],
    ["x@example.go.kr", "", "운영자", "", ""],
    ["t1@example.go.kr", "", "팀", "", ""],
    ["t2@example.go.kr", "", "팀", "없는팀", ""],
    ["v@example.go.kr", "", "전체열람", "보안팀", ""],
    ["ip@example.go.kr", "", "팀", "보안팀", "10.0.0.300"],
    ["dup@example.go.kr", "", "팀", "보안팀", ""],
    ["DUP@example.go.kr", "", "팀", "보안팀", ""],
  ], ctx);
  assert.equal(users.length, 1); // 첫 dup 만 통과
  assert.deepEqual(errors.map((e) => e.row), [2, 3, 5, 6, 7, 8, 9, 10, 12]);
  const msg = (row: number) => errors.find((e) => e.row === row)!.message;
  assert.match(msg(3), /이미 등록된/);
  assert.match(msg(5), /총괄/);
  assert.match(msg(7), /소속 팀/);
  assert.match(msg(8), /없습니다/);
  assert.match(msg(9), /비워/);
  assert.match(msg(10), /허용IP/);
  assert.match(msg(12), /11행/);
});

test("헤더에 이메일 열이 없거나 빈 시트·빈 데이터면 오류", () => {
  assert.match(validateUserRows([["이름", "역할"], ["홍", "팀"]], ctx).errors[0].message, /이메일/);
  assert.equal(validateUserRows([], ctx).errors.length, 1);
  assert.match(validateUserRows([H, [null, null]], ctx).errors[0].message, /등록할 행/);
});

test(`상한: ${USER_IMPORT_MAX_ROWS}명 초과는 전체 거부`, () => {
  const rows: unknown[][] = [H];
  for (let i = 0; i <= USER_IMPORT_MAX_ROWS; i++) rows.push([`u${i}@example.go.kr`, "", "전체열람", "", ""]);
  const r = validateUserRows(rows, ctx);
  assert.equal(r.users.length, 0);
  assert.match(r.errors[0].message, /최대/);
});

test("양식 왕복: 내려받은 양식 첫 시트의 헤더로 작성한 파일이 그대로 검증된다", async () => {
  const buf = await buildUserImportTemplate(["정보운영팀"]);
  const rows = await parseUploadBuffer(buf);
  assert.deepEqual(rows[0], H);
  assert.equal(rows.length, 1); // 입력 시트에는 예시 행이 없다(지우지 않고 올려도 등록되지 않게)
  const { users, errors } = validateUserRows([...rows, ["new@example.go.kr", "신규", "팀", "정보운영팀", ""]], ctx);
  assert.deepEqual(errors, []);
  assert.equal(users[0].team_id, 7);
});

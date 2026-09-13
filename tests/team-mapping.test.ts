// tests/team-mapping.test.ts — 부서명 → 팀 자동 추천 (미배정 큐 부서별 일괄 배정)
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, suggestTeam } from "../src/lib/team-mapping.ts";

const teams = [
  { id: 1, team_name: "정보보호팀" },
  { id: 2, team_name: "인프라운영팀" },
  { id: 3, team_name: "정보보안센터" },
  { id: 4, team_name: "데이터 분석과" },
];

test("normalizeName: 공백·괄호·접미(팀/부/과/센터) 제거, 소문자", () => {
  assert.equal(normalizeName("정보보호팀"), "정보보호");
  assert.equal(normalizeName("인프라 운영팀 (2실)"), "인프라운영");
  assert.equal(normalizeName("Data Analytics 과"), "dataanalytics");
  assert.equal(normalizeName(""), "");
});

test("suggestTeam: 완전일치 우선", () => {
  assert.equal(suggestTeam("정보보호팀", teams), 1);
  assert.equal(suggestTeam("정보보호부", teams), 1, "접미만 다르면 완전일치");
  assert.equal(suggestTeam("데이터분석", teams), 4);
});

test("suggestTeam: 포함 관계는 2글자 이상 + 더 긴 팀명 우선", () => {
  assert.equal(suggestTeam("인프라운영 2파트", teams), 2);
  // '정보보안' 은 '정보보안센터'(norm 정보보안) 완전일치
  assert.equal(suggestTeam("정보보안", teams), 3);
});

test("suggestTeam: 빈 부서·매칭 없음은 null (자동 배정하지 않는다)", () => {
  assert.equal(suggestTeam("", teams), null);
  assert.equal(suggestTeam("   ", teams), null);
  assert.equal(suggestTeam("총무팀", teams), null);
  assert.equal(suggestTeam("정보", teams), null, "한 글자·짧은 토큰 우연 일치 금지");
});

/**
 * 부서명과 팀명을 정규화(공백/괄호/'팀'|'부'|'과'|'센터' 접미 제거, 소문자)해
 * 완전일치 → 포함 → 없으면 null을 반환하는 순수 함수.
 */
export function normalizeName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[()\[\]{}]/g, "")
    .replace(/\s+/g, "")
    .replace(/(팀|부|과|센터)+$/g, "");
}

export function suggestTeam(
  department: string,
  teams: { id: number; team_name: string }[],
): number | null {
  if (!department || !department.trim()) {
    return null;
  }
  const normDept = normalizeName(department);
  if (!normDept) return null;

  // 1. 완전일치
  for (const team of teams) {
    const normTeam = normalizeName(team.team_name);
    if (normTeam && normDept === normTeam) {
      return team.id;
    }
  }

  // 2. 포함 관계 (부서명에 팀명이 포함되거나 팀명에 부서명이 포함).
  //    한 글자짜리 토큰은 우연 일치가 너무 잦아("정보" ⊂ "정보보호", "보안" ⊂ "정보보안부") 2글자 이상에만 허용.
  //    어디까지나 *추천* 이다 — 총괄이 드롭다운에서 확인하고 배정한다.
  const candidates = teams
    .map((t) => ({ id: t.id, norm: normalizeName(t.team_name) }))
    .filter((t) => t.norm.length >= 2 && normDept.length >= 2 && (normDept.includes(t.norm) || t.norm.includes(normDept)))
    // 더 긴 일치(더 구체적인 팀명)를 우선
    .sort((a, b) => b.norm.length - a.norm.length);
  // 후보가 하나일 때만 추천. 여럿이면("정보" → 정보보호팀/정보보안센터) 자동 선택하지 않고 총괄에게 맡긴다.
  if (candidates.length === 1) return candidates[0].id;

  return null;
}

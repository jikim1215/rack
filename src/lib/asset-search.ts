// 자산 다중 IP 검색 절 (AC-5). 순수 모듈(프레임워크/DB import 없음)이라 라우트와 테스트가 동일 SQL을 공유.
// 대표 IP(assets.ip_address) + 다중 IP(asset_ips: vip/extra 등 모든 타입) + 추가 IP(custom_values 중
// field_key='additional_ips')를 UNION 매칭한다. malformed IP는 운영 컬럼/asset_ips에 적재되지 않고
// import_issue(raw)로만 보존되므로 검색 결과에서 자연히 제외된다(운영 데이터만 매칭).
export interface SqlClause {
  sql: string;
  params: unknown[];
}

const ADDITIONAL_IPS_KEY = "additional_ips";

/**
 * @param q       검색어(IP 일부/전체). 빈 문자열이면 항상 참(1=1) 반환(검색 미적용).
 * @param alias   assets 테이블 별칭 (기본 'a').
 */
export function ipSearchClause(q: string, alias = "a"): SqlClause {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error(`unsafe alias: ${alias}`); // 개발자 상수만 허용(방어적)
  const term = (q ?? "").trim();
  if (!term) return { sql: "(1 = 1)", params: [] };
  const like = `%${term}%`;
  return {
    sql:
      `(${alias}.ip_address LIKE ?` +
      ` OR EXISTS (SELECT 1 FROM asset_ips ai WHERE ai.asset_id = ${alias}.id AND ai.ip_address LIKE ?)` +
      ` OR EXISTS (SELECT 1 FROM custom_values cv JOIN custom_fields cf ON cv.field_id = cf.id` +
      ` WHERE cv.asset_id = ${alias}.id AND cf.field_key = '${ADDITIONAL_IPS_KEY}' AND cv.value LIKE ?))`,
    params: [like, like, like],
  };
}

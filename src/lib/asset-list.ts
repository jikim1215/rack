// ── 자산 목록 조회 (서버 페이지네이션) — API 라우트와 /assets 페이지 SSR 이 공유 ──
// 1만 대 벤치: SQL 은 4ms 인데 전량 응답이 6.8MB/150ms + 브라우저 1만 행 DOM 이 병목이었다.
// → 필터·검색·정렬을 서버로 옮기고 페이지 단위(기본 100)로만 내려준다. 전량이 꼭 필요한 호출은 limit=0.
import type Database from "better-sqlite3";
import type { Actor } from "./authz.ts";
import { scopeWhere, unassignedScopeWhere } from "./authz.ts";
import { ipSearchClause } from "./asset-search.ts";
import { STALE_DAYS } from "./freshness.ts";
import type { AssetRow, CustomValueRow } from "./db-types.ts";

export const ASSET_PAGE_DEFAULT = 100;
export const ASSET_PAGE_MAX = 500;
/** limit=0(전량) 안전 상한 — 엑셀 내보내기 등. 이보다 크면 내보내기 쪽에서 나눠 가져가야 한다. */
export const ASSET_ALL_CAP = 20_000;

export const ASSET_SORT_COLUMNS = {
  created_at: "a.created_at",
  updated_at: "a.updated_at",
  verified_at: "a.verified_at",
  asset_name: "a.asset_name",
  asset_type: "a.asset_type",
  ip_address: "a.ip_address",
  status: "a.status",
  manufacturer: "a.manufacturer",
  rack_name: "r.rack_name",
} as const;
export type AssetSortKey = keyof typeof ASSET_SORT_COLUMNS;

export const ASSET_MISSING_FILTERS = ["ip", "rack", "admin", "os", "serial", "verify"] as const;
export type AssetMissingFilter = (typeof ASSET_MISSING_FILTERS)[number];

export interface AssetListParams {
  q?: string;
  type?: string;
  rack_id?: number | null;
  status?: string;
  missing?: AssetMissingFilter | "";
  sort?: AssetSortKey;
  dir?: "asc" | "desc";
  /** 0 = 전량(ASSET_ALL_CAP 상한). 미지정 = ASSET_PAGE_DEFAULT */
  limit?: number;
  offset?: number;
  /** true 면 페이지 행의 커스텀 필드 값도 함께 */
  withCustomValues?: boolean;
  /** 총괄 전용 미배정 큐(team_id IS NULL) — 호출부가 assertAdmin 을 먼저 거친다 */
  unassignedOnly?: boolean;
}

export type AssetListRow = AssetRow & { rack_name: string | null; location_name: string | null; team_name: string | null };

export interface AssetListResult {
  rows: AssetListRow[];
  total: number;
  limit: number;
  offset: number;
  /** asset_id → { field_id → value } (withCustomValues 일 때만) */
  customValues?: Record<number, Record<number, string>>;
}

/** 쿼리스트링 → 정규화된 파라미터 (API 라우트용). 잘못된 값은 무시/기본값. */
export function parseAssetListParams(sp: URLSearchParams): AssetListParams {
  const num = (v: string | null) => (v == null || v === "" ? undefined : Number(v));
  const rackRaw = num(sp.get("rack_id"));
  const missing = sp.get("missing") ?? "";
  const sort = sp.get("sort") ?? "";
  const dir = sp.get("dir") === "asc" ? "asc" : "desc";
  const limitRaw = num(sp.get("limit"));
  return {
    q: sp.get("q") ?? "",
    type: sp.get("type") ?? "",
    rack_id: Number.isInteger(rackRaw) && rackRaw! > 0 ? rackRaw! : null,
    status: sp.get("status") ?? "",
    missing: (ASSET_MISSING_FILTERS as readonly string[]).includes(missing) ? (missing as AssetMissingFilter) : "",
    sort: sort in ASSET_SORT_COLUMNS ? (sort as AssetSortKey) : "created_at",
    dir,
    limit: limitRaw === undefined || !Number.isFinite(limitRaw) ? ASSET_PAGE_DEFAULT : Math.max(0, Math.floor(limitRaw)),
    offset: Math.max(0, Math.floor(num(sp.get("offset")) ?? 0) || 0),
    withCustomValues: sp.get("cv") === "1",
  };
}

const TEXT_SEARCH_COLUMNS = [
  "a.asset_name", "a.access_ip", "a.manufacturer", "a.model", "a.serial_number",
  "a.os", "a.admin_name", "a.user_name", "a.department", "t.team_name",
];

export function listAssets(db: Database.Database, actor: Actor | null, p: AssetListParams): AssetListResult {
  const scope = p.unassignedOnly ? unassignedScopeWhere(actor, "a.team_id") : scopeWhere(actor, "a.team_id");
  const where: string[] = [scope.sql];
  const params: unknown[] = [...scope.params];

  // 검색: 대표 IP + 다중 IP + 추가 IP(커스텀) 는 기존 UNION 절, 그 외 텍스트 컬럼은 LIKE. 화면 검색과 동일 범위.
  const q = (p.q ?? "").trim();
  if (q) {
    const ip = ipSearchClause(q, "a");
    const like = `%${q}%`;
    where.push(`(${ip.sql} OR ${TEXT_SEARCH_COLUMNS.map((c) => `COALESCE(${c},'') LIKE ?`).join(" OR ")})`);
    params.push(...ip.params, ...TEXT_SEARCH_COLUMNS.map(() => like));
  }
  if (p.type) { where.push("a.asset_type = ?"); params.push(p.type); }
  if (p.rack_id != null) { where.push("a.rack_id = ?"); params.push(p.rack_id); }
  if (p.status) { where.push("a.status = ?"); params.push(p.status); }
  if (p.missing) {
    // 정비 대상 필터 — 폐기 자산은 정비 대상이 아니다(화면 규칙과 동일)
    where.push("a.status != 'retired'");
    switch (p.missing) {
      case "ip": where.push("a.ip_address = ''"); break;
      case "rack": where.push("a.rack_id IS NULL"); break;
      case "admin": where.push("a.admin_name = ''"); break;
      case "os": where.push("a.os = ''"); break;
      case "serial": where.push("a.serial_number = ''"); break;
      case "verify": where.push(`(a.verified_at = '' OR a.verified_at < datetime('now','-${STALE_DAYS} days','localtime'))`); break;
    }
  }
  const whereSql = where.join(" AND ");
  const sortCol = ASSET_SORT_COLUMNS[p.sort ?? "created_at"];
  const dir = p.dir === "asc" ? "ASC" : "DESC";
  // 2차 정렬로 id 를 두어 페이지 경계가 흔들리지 않게(같은 값이 많은 컬럼 정렬 시 중복/누락 방지)
  const orderSql = `ORDER BY ${sortCol} ${dir}, a.id DESC`;

  const fromSql = `
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN locations l ON r.location_id = l.id
    LEFT JOIN teams t ON a.team_id = t.id
    WHERE ${whereSql}`;

  const total = (db.prepare(`SELECT COUNT(*) AS c ${fromSql}`).get(...params) as { c: number }).c;
  const limit = p.limit === 0 ? ASSET_ALL_CAP : Math.min(Math.max(p.limit ?? ASSET_PAGE_DEFAULT, 1), ASSET_PAGE_MAX);
  const offset = Math.max(p.offset ?? 0, 0);
  const rows = db.prepare(`SELECT a.*, r.rack_name, l.location_name, t.team_name ${fromSql} ${orderSql} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as AssetListRow[];

  const result: AssetListResult = { rows, total, limit, offset };
  if (p.withCustomValues && rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const cvs = db.prepare(`
      SELECT cv.asset_id, cv.field_id, cv.value FROM custom_values cv
      JOIN custom_fields cf ON cv.field_id = cf.id
      WHERE cf.is_active = 1 AND cv.asset_id IN (${ids.map(() => "?").join(",")})
    `).all(...ids) as Pick<CustomValueRow, "asset_id" | "field_id" | "value">[];
    const map: Record<number, Record<number, string>> = {};
    for (const cv of cvs) (map[cv.asset_id] ??= {})[cv.field_id] = cv.value;
    result.customValues = map;
  }
  return result;
}

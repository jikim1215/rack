// ── 서버측 행수준(row-level) 인가 (ADR-007) ──
// 신뢰 경계는 서버다. 모든 데이터 반환 API(read/list/search/detail/aggregate/export/preview)는
// scopeWhere()로 행을 제한하고, 모든 쓰기/삭제/다운로드 API는 assertCan*()로 권한을 강제한다.
// default-deny: 알 수 없는 역할/미인증/팀 미배정 team 계정은 아무것도 보지 못한다.
//
// 소유 모델(ADR-009): assets.team_id 가 소유의 단일 권위. assets.department 는 읽기전용 레거시 음영.
//  - admin(총괄): 전체 무제한 (읽기/쓰기/삭제/다운로드)
//  - team(팀)  : 자기 팀 소유 자산만 (미배정 team_id IS NULL 제외), 자기 팀 범위 내 쓰기/삭제
//  - viewer(전체열람): 전체 읽기/다운로드 가능하나 쓰기/삭제 불가 (ADR-010)
import type { SessionPayload, Role } from "@/lib/auth";

export type { Role };

export interface Actor {
  userId: number;
  username: string;
  role: Role;
  teamId: number | null;
}

const VALID_ROLES: ReadonlySet<string> = new Set<Role>(["admin", "team", "viewer"]);

/** 세션에서 인가 주체를 도출한다. 미인증/미지원 역할이면 null (default-deny). */
export function actorFromSession(session: SessionPayload | null | undefined): Actor | null {
  if (!session) return null;
  if (!VALID_ROLES.has(session.role)) return null; // 알 수 없는 역할 → deny
  return {
    userId: session.userId,
    username: session.username,
    role: session.role as Role,
    teamId: session.teamId ?? null,
  };
}

export class AuthzError extends Error {
  readonly status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "AuthzError";
    this.status = status;
  }
}

/** 인가 주체가 없으면(미인증) 401, 권한 부족이면 403을 던진다. */
function deny(actor: Actor | null, message: string): never {
  throw new AuthzError(actor ? message : "Unauthorized", actor ? 403 : 401);
}

export interface ScopeClause {
  /** 항상 truthy/falsy 한 단일 boolean SQL 식 (괄호로 감싸 안전). */
  sql: string;
  params: unknown[];
}

const ALLOW_ALL: ScopeClause = { sql: "(1 = 1)", params: [] };
const DENY_ALL: ScopeClause = { sql: "(1 = 0)", params: [] };

// scopeWhere의 column은 개발자 상수여야 한다(사용자 입력 금지). 방어적 식별자 검증.
const SAFE_COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
function assertSafeColumn(column: string): void {
  if (!SAFE_COLUMN_RE.test(column)) {
    throw new AuthzError(`unsafe scope column: ${column}`, 500);
  }
}

/**
 * 팀 소유(assets 등 team_id 보유) 테이블의 행 제한 절을 만든다.
 * @param column  team_id 컬럼의 정규화된 SQL 식 (예: "team_id", "a.team_id")
 *
 * admin/viewer: 무제한(읽기). team: 자기 팀만(미배정 제외). 그 외/미인증: deny-all.
 * 읽기 전용 scopeWhere이므로 viewer도 ALLOW_ALL(ADR-010 전체 열람). 쓰기 통제는 assertCan*가 담당.
 */
export function scopeWhere(actor: Actor | null, column = "team_id"): ScopeClause {
  if (!actor) return DENY_ALL;
  switch (actor.role) {
    case "admin":
    case "viewer":
      return ALLOW_ALL;
    case "team":
      if (actor.teamId == null) return DENY_ALL; // 팀 미배정 team 계정은 아무것도 못 봄
      assertSafeColumn(column);
      return { sql: `(${column} = ?)`, params: [actor.teamId] };
    default:
      return DENY_ALL;
  }
}

/** 미배정(team_id IS NULL) 자산만 보는 범위 — 총괄(admin) 전용 재배정 큐(AC-11). */
export function unassignedScopeWhere(actor: Actor | null, column = "team_id"): ScopeClause {
  if (!actor || actor.role !== "admin") return DENY_ALL;
  assertSafeColumn(column);
  return { sql: `(${column} IS NULL)`, params: [] };
}

// ── 인프라 소유 스코프 (ADR-011: 부서 독립 운영) ──
// 랙/위치/배선/대역/계약은 자산과 달리 물리 인프라라 소유 모델이 두 갈래다.
//  - 하이브리드(rack/location): 전용 소유(team_id) OR 파생(내 팀 자산·리소스가 그 안에 존재).
//    외부 IDC·공용센터 외부 부서는 전용 소유로 빈 랙도 보고, 공유 센터(team_id NULL)는 파생으로 본다.
//  - 소유 전용(frame/subnet/contract): team_id 일치만. 공유 없음(사용자 확정). NULL = 총괄 전용.
// admin/viewer는 전체 열람. 미인증/미배정 team은 deny-all.

/**
 * 랙 하이브리드 가시성. rackTeamCol=랙 소유팀 컬럼, rackIdCol=랙 PK 컬럼(자산 상관 서브쿼리용).
 * team: (소유팀 = 내팀) OR (그 랙에 내 팀 자산 존재). admin/viewer: 전체.
 */
export function rackScopeWhere(
  actor: Actor | null,
  rackTeamCol = "r.team_id",
  rackIdCol = "r.id",
): ScopeClause {
  if (!actor) return DENY_ALL;
  if (actor.role === "admin" || actor.role === "viewer") return ALLOW_ALL;
  if (actor.role === "team") {
    if (actor.teamId == null) return DENY_ALL;
    assertSafeColumn(rackTeamCol);
    assertSafeColumn(rackIdCol);
    return {
      sql: `(${rackTeamCol} = ? OR EXISTS (SELECT 1 FROM assets _a WHERE _a.rack_id = ${rackIdCol} AND _a.team_id = ?))`,
      params: [actor.teamId, actor.teamId],
    };
  }
  return DENY_ALL;
}

/**
 * 위치 하이브리드 가시성. locTeamCol=위치 소유팀, locIdCol=위치 PK.
 * team: (소유팀 = 내팀) OR 그 위치에 (내게 보이는 랙 | 내 대역 | 내 배선)이 존재. admin/viewer: 전체.
 */
export function locationScopeWhere(
  actor: Actor | null,
  locTeamCol = "l.team_id",
  locIdCol = "l.id",
): ScopeClause {
  if (!actor) return DENY_ALL;
  if (actor.role === "admin" || actor.role === "viewer") return ALLOW_ALL;
  if (actor.role === "team") {
    if (actor.teamId == null) return DENY_ALL;
    assertSafeColumn(locTeamCol);
    assertSafeColumn(locIdCol);
    const t = actor.teamId;
    return {
      sql: `(${locTeamCol} = ?
        OR EXISTS (SELECT 1 FROM racks _r WHERE _r.location_id = ${locIdCol}
                   AND (_r.team_id = ? OR EXISTS (SELECT 1 FROM assets _a WHERE _a.rack_id = _r.id AND _a.team_id = ?)))
        OR EXISTS (SELECT 1 FROM ip_subnets _s WHERE _s.location_id = ${locIdCol} AND _s.team_id = ?)
        OR EXISTS (SELECT 1 FROM dist_frames _f WHERE _f.location_id = ${locIdCol} AND _f.team_id = ?))`,
      params: [t, t, t, t, t],
    };
  }
  return DENY_ALL;
}

/**
 * 랙 쓰기/배치 권한. 팀은 자기 소유 랙 또는 공유(team_id NULL) 랙에만 자산 배치 가능.
 * 타팀 전용 랙(다른 team_id)에는 배치 불가. admin: 무제한. viewer: 불가.
 * @param rackOwnerTeamId 대상 랙의 team_id (NULL=공유)
 */
export function assertCanPlaceInRack(
  actor: Actor | null,
  rackOwnerTeamId: number | null,
): asserts actor is Actor {
  if (!actor) deny(actor, "Forbidden");
  if (actor.role === "admin") return;
  if (actor.role === "viewer") deny(actor, "열람 전용 계정은 배치 권한이 없습니다.");
  if (actor.role === "team") {
    if (actor.teamId == null) deny(actor, "팀이 배정되지 않은 계정은 배치 권한이 없습니다.");
    if (rackOwnerTeamId != null && rackOwnerTeamId !== actor.teamId) {
      deny(actor, "다른 팀 전용 랙에는 자산을 배치할 수 없습니다.");
    }
    return;
  }
  deny(actor, "Forbidden");
}

/** 인증된 유효 역할이면 읽기 허용(행 제한은 scopeWhere가 담당). 아니면 deny. */
export function assertCanRead(actor: Actor | null): asserts actor is Actor {
  if (!actor) deny(actor, "Forbidden");
}

/**
 * 특정 팀 소유 행에 대한 쓰기 권한 강제.
 * admin: 전체. team: 자기 팀 소유 행만(미배정 행은 쓰기 불가 → 총괄 재배정 영역). viewer: 불가.
 * @param ownerTeamId 대상 행의 team_id (신규 생성 시 배정하려는 team_id). 생략 시 일반 쓰기 권한만 확인.
 */
export function assertCanWrite(
  actor: Actor | null,
  ownerTeamId?: number | null,
): asserts actor is Actor {
  if (!actor) deny(actor, "Forbidden");
  if (actor.role === "admin") return;
  if (actor.role === "viewer") deny(actor, "열람 전용 계정은 쓰기 권한이 없습니다.");
  if (actor.role === "team") {
    if (actor.teamId == null) deny(actor, "팀이 배정되지 않은 계정은 쓰기 권한이 없습니다.");
    if (ownerTeamId !== undefined && ownerTeamId !== actor.teamId) {
      deny(actor, "다른 팀 소유 자산은 수정할 수 없습니다.");
    }
    return;
  }
  deny(actor, "Forbidden");
}

/** 삭제 권한 강제 (쓰기와 동일 정책). */
export function assertCanDelete(
  actor: Actor | null,
  ownerTeamId?: number | null,
): asserts actor is Actor {
  assertCanWrite(actor, ownerTeamId);
}

/** 다운로드(export) 권한 강제. admin/team/viewer 모두 가능(viewer 전체 다운로드, ADR-010). 미인증만 거부. */
export function assertCanDownload(actor: Actor | null): asserts actor is Actor {
  if (!actor) deny(actor, "Forbidden");
}

/** 총괄(admin) 전용 작업(계정/팀/권한/감사/재배정 등) 강제. */
export function assertAdmin(actor: Actor | null): asserts actor is Actor {
  if (!actor) deny(actor, "Forbidden");
  if (actor.role !== "admin") deny(actor, "총괄(관리자) 전용 기능입니다.");
}

/** WHERE 절 조립 헬퍼: 기존 조건들과 scope 절을 AND로 결합. */
export function andScope(scope: ScopeClause, ...extra: string[]): string {
  const parts = [scope.sql, ...extra.filter(Boolean)];
  return parts.join(" AND ");
}

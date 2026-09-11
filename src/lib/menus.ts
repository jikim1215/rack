// ── 메뉴 레지스트리 (단일 정본) ──
// 사이드바(nav) · 설정→메뉴 권한 화면 · menu_permissions 기본 시드(db.ts) · 권한 API 고정키 ·
// API 경로→메뉴 매핑(authz) 이 전부 이 파일 하나를 읽는다. 메뉴를 추가/삭제할 때 다른 파일을 고치지 않는다.
// (과거 5곳에 흩어져 있어 portmap/topology 유령 권한 행이 남는 드리프트가 있었다.)
// 순수 모듈: 아이콘(lucide)·DB·Next 의존 없음 — 사이드바가 key→아이콘을 자체 매핑한다.

export type MenuRole = "admin" | "team" | "viewer";

/** [can_access, can_write, can_approve] */
export type PermTriple = readonly [0 | 1, 0 | 1, 0 | 1];

export interface MenuDef {
  key: string;
  label: string;
  href: string;
  /** 총괄 전용 메뉴 — 사이드바에서 비관리자에게 숨기고, 권한 화면에도 노출하지 않는다. */
  adminOnly?: boolean;
  /** 접근을 끌 수 없는 메뉴(대시보드/설정). 권한 저장 시 can_access=1 로 고정. */
  fixedAccess?: boolean;
  /** 권한 화면에서 '쓰기' 체크박스를 노출하는 메뉴. */
  writable?: boolean;
  /** 권한 화면에서 '승인' 체크박스를 노출하는 메뉴. */
  approvable?: boolean;
  /** 역할별 기본 권한. DB에 행이 없을 때(신규 메뉴/시드 전) 서버 인가의 폴백이자 최초 시드 값. */
  defaults: Record<MenuRole, PermTriple>;
  /** 이 메뉴에 귀속되는 API 경로 접두사 — 가드레일 테스트(모든 라우트가 메뉴 인가를 거치는지)가 참조. */
  apiPrefixes: readonly string[];
}

const ADMIN_ALL: PermTriple = [1, 1, 1];

export const MENUS: readonly MenuDef[] = [
  {
    key: "dashboard", label: "대시보드", href: "/", fixedAccess: true,
    defaults: { admin: ADMIN_ALL, team: [1, 0, 0], viewer: [1, 0, 0] },
    apiPrefixes: [],
  },
  {
    key: "assets", label: "자산관리", href: "/assets", writable: true,
    defaults: { admin: ADMIN_ALL, team: [1, 1, 0], viewer: [1, 0, 0] },
    apiPrefixes: ["/api/assets", "/api/custom-fields", "/api/ports"],
  },
  {
    key: "subassets", label: "부속자산", href: "/subassets", writable: true,
    defaults: { admin: ADMIN_ALL, team: [1, 1, 0], viewer: [1, 0, 0] },
    apiPrefixes: ["/api/sub-assets"],
  },
  {
    key: "racks", label: "랙 실장도", href: "/racks", writable: true,
    defaults: { admin: ADMIN_ALL, team: [1, 0, 0], viewer: [1, 0, 0] },
    apiPrefixes: ["/api/racks"],
  },
  {
    key: "ipam", label: "IP관리", href: "/ipam", writable: true,
    defaults: { admin: ADMIN_ALL, team: [1, 0, 0], viewer: [1, 0, 0] },
    apiPrefixes: ["/api/subnets"],
  },
  {
    key: "distribution", label: "배선관리", href: "/distribution", writable: true,
    defaults: { admin: ADMIN_ALL, team: [1, 0, 0], viewer: [0, 0, 0] },
    apiPrefixes: ["/api/frames"],
  },
  {
    key: "movements", label: "반입/반출", href: "/movements", writable: true, approvable: true,
    defaults: { admin: ADMIN_ALL, team: [1, 1, 0], viewer: [1, 0, 0] },
    apiPrefixes: ["/api/movements"],
  },
  {
    key: "maintenance", label: "유지보수", href: "/maintenance", writable: true,
    defaults: { admin: ADMIN_ALL, team: [1, 1, 0], viewer: [1, 0, 0] },
    apiPrefixes: ["/api/maintenance"],
  },
  {
    key: "inspection", label: "자산실사", href: "/inspection", writable: true,
    defaults: { admin: ADMIN_ALL, team: [1, 1, 0], viewer: [1, 0, 0] },
    apiPrefixes: ["/api/inventory-audits"],
  },
  {
    key: "contracts", label: "계약관리", href: "/contracts", writable: true,
    defaults: { admin: ADMIN_ALL, team: [0, 0, 0], viewer: [0, 0, 0] },
    apiPrefixes: ["/api/contracts", "/api/vendors"],
  },
  {
    key: "reports", label: "통계 리포트", href: "/reports",
    defaults: { admin: ADMIN_ALL, team: [1, 0, 0], viewer: [1, 0, 0] },
    apiPrefixes: [],
  },
  {
    key: "locations", label: "위치관리", href: "/locations", writable: true,
    defaults: { admin: ADMIN_ALL, team: [1, 0, 0], viewer: [0, 0, 0] },
    apiPrefixes: ["/api/locations"],
  },
  {
    key: "feedback", label: "개선의견", href: "/feedback", writable: true,
    defaults: { admin: ADMIN_ALL, team: [1, 1, 0], viewer: [1, 1, 0] },
    apiPrefixes: ["/api/feedback"],
  },
  {
    key: "logs", label: "로그/감사", href: "/logs", adminOnly: true,
    defaults: { admin: ADMIN_ALL, team: [0, 0, 0], viewer: [0, 0, 0] },
    apiPrefixes: ["/api/audit", "/api/access-logs"],
  },
  {
    key: "settings", label: "설정", href: "/settings", fixedAccess: true,
    defaults: { admin: ADMIN_ALL, team: [1, 0, 0], viewer: [1, 0, 0] },
    apiPrefixes: ["/api/users", "/api/teams", "/api/permissions", "/api/admin"],
  },
];

export type MenuKey = (typeof MENUS)[number]["key"];

const BY_KEY = new Map(MENUS.map((m) => [m.key, m] as const));

export function menuByKey(key: string): MenuDef | undefined {
  return BY_KEY.get(key);
}

/** 권한 화면에 노출하는 메뉴 (총괄 전용 메뉴 제외 — 역할로 이미 고정). */
export const PERMISSION_MENUS: readonly MenuDef[] = MENUS.filter((m) => !m.adminOnly);

export const FIXED_ACCESS_KEYS: readonly string[] = MENUS.filter((m) => m.fixedAccess).map((m) => m.key);

/** 사이드바 href → 메뉴 키 ("/"=dashboard, "/assets"=assets …). */
export function menuKeyForHref(href: string): string {
  return href === "/" ? "dashboard" : href.replace(/^\//, "");
}

/** 총괄이 아닌 사용자에게 유효한 메뉴 키인지 (레지스트리 밖 키는 권한 저장 대상이 아니다). */
export function isMenuKey(key: string): key is MenuKey {
  return BY_KEY.has(key);
}

// ── API 경로 분류 (미들웨어 방어 게이트 + 가드레일 테스트가 같은 배열을 읽는다 — 세 곳 수작업 불일치 방지, 비평 반영) ──
/** 총괄(admin) 전용 API 접두사. 미들웨어가 비관리자를 403 으로 막고, 핸들러의 assertAdmin 이 최종 권위. */
export const ADMIN_ONLY_API_PREFIXES: readonly string[] = [
  "/api/users", "/api/teams", "/api/audit", "/api/access-logs", "/api/admin",
  "/api/import-issues", "/api/assets/reassign", "/api/assets/import/rollback",
];
/** 인증만 있으면 전 역할이 부르는 경로 (메뉴 인가 대상 아님): 인증 자체, 자기 역할 권한 조회(GET; PUT 은 assertAdmin). */
export const SESSION_ONLY_API_PREFIXES: readonly string[] = ["/api/auth", "/api/permissions"];

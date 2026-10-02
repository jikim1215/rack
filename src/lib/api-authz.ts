// Next 라우트용 얇은 인가 어댑터. 순수 모듈 authz.ts(테스트 대상)와 분리한다.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { actorFromSession, AuthzError, assertCanUseLocation, assertCanPlaceInRack, assertCanReferenceAsset, type Actor, type MenuPerm } from "@/lib/authz";
import { ValidationError } from "@/lib/validation/input";
import { UPLOAD_MAX_BYTES } from "@/lib/validation/upload";

// multipart 경계·헤더·부가 필드(dry_run 등) 여유. 파일 자체는 assertUploadSize 가 정확히 잰다.
const UPLOAD_MULTIPART_SLACK = 1024 * 1024;

/** 역할의 menu_permissions 행을 한 번에 읽는다 (요청당 1회, SQLite 경량 조회). */
export function loadMenuPerms(role: string): Record<string, MenuPerm> {
  const rows = getDb()
    .prepare("SELECT menu_key, can_access, can_write, can_approve FROM menu_permissions WHERE role = ?")
    .all(role) as { menu_key: string; can_access: number; can_write: number; can_approve: number }[];
  const perms: Record<string, MenuPerm> = {};
  for (const r of rows) perms[r.menu_key] = { access: !!r.can_access, write: !!r.can_write, approve: !!r.can_approve };
  return perms;
}

/** 현재 요청의 인가 주체 (미인증이면 null). 메뉴 권한을 포함한다. */
export async function getActor(): Promise<Actor | null> {
  const session = await getSession();
  if (!session) return null;
  // admin 은 메뉴 권한을 무조건 통과하므로 조회를 생략한다.
  return actorFromSession(session, session.role === "admin" ? {} : loadMenuPerms(session.role));
}

// ── 참조 대상 인가 (격리 우회 방지) ──
// 팀이 타팀 전용 위치·랙에 자기 리소스를 두거나 타팀 자산을 부모로 연결하면, 하이브리드 가시성(파생)과
// 조인 결과로 그 위치·랙·자산이 노출된다. 만들거나 옮길 때만 호출한다(이미 있는 값은 그대로 둠).

/** 위치가 존재하고 이 주체가 그 위치를 쓸 수 있는지(자기 소유 또는 공유). */
export function assertUsableLocation(actor: Actor | null, locationId: number): void {
  const loc = getDb().prepare("SELECT team_id FROM locations WHERE id = ?").get(locationId) as { team_id: number | null } | undefined;
  if (!loc) throw new ValidationError("존재하지 않는 위치입니다.");
  assertCanUseLocation(actor, loc.team_id ?? null);
}

/** 랙이 존재하고 이 주체가 그 랙에 놓을 수 있는지(자기 소유 또는 공유). */
export function assertUsableRack(actor: Actor | null, rackId: number): void {
  const rack = getDb().prepare("SELECT team_id FROM racks WHERE id = ?").get(rackId) as { team_id: number | null } | undefined;
  if (!rack) throw new ValidationError("존재하지 않는 랙입니다.");
  assertCanPlaceInRack(actor, rack.team_id ?? null);
}

/** 자산이 존재하고 이 주체가 그 자산을 참조(부모 장비 등)할 수 있는지(팀은 자기 팀 자산만). */
export function assertReferableAsset(actor: Actor | null, assetId: number, label = "부모 장비"): void {
  const asset = getDb().prepare("SELECT team_id FROM assets WHERE id = ?").get(assetId) as { team_id: number | null } | undefined;
  if (!asset) throw new ValidationError(`${label}를 찾을 수 없습니다.`);
  assertCanReferenceAsset(actor, asset.team_id ?? null);
}

// SQLite 제약 위반 → 사용자 메시지. 검증을 통과했더라도 동시성/FK 등으로 DB가 거부할 수 있다.
const SQLITE_CONSTRAINT_MESSAGES: Record<string, { status: number; message: string }> = {
  SQLITE_CONSTRAINT_UNIQUE: { status: 409, message: "이미 존재하는 값입니다(중복)." },
  SQLITE_CONSTRAINT_PRIMARYKEY: { status: 409, message: "이미 존재하는 값입니다(중복)." },
  SQLITE_CONSTRAINT_FOREIGNKEY: { status: 400, message: "참조하는 항목이 존재하지 않거나 다른 데이터가 참조 중입니다." },
  SQLITE_CONSTRAINT_CHECK: { status: 400, message: "입력값이 허용 범위를 벗어났습니다." },
  SQLITE_CONSTRAINT_NOTNULL: { status: 400, message: "필수 항목이 비어 있습니다." },
  SQLITE_CONSTRAINT_TRIGGER: { status: 400, message: "허용되지 않는 변경입니다." },
};

/**
 * 라우트 예외 → JSON 응답. AuthzError(401/403) · ValidationError(400) · JSON 파싱 오류(400) ·
 * SQLite 제약(400/409) · 그 외 500(메시지 미노출, 서버 로그만).
 */
export function apiErrorResponse(e: unknown): NextResponse {
  // AuthzError 는 401/403 만 그대로 노출. 5xx 인 AuthzError(예: 안전하지 않은 scope 컬럼)는 개발자 오류이므로 일반 500 경로로(메시지 비노출).
  if (e instanceof AuthzError && e.status < 500) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
  const code = (e as { code?: unknown })?.code;
  if (typeof code === "string" && code in SQLITE_CONSTRAINT_MESSAGES) {
    const m = SQLITE_CONSTRAINT_MESSAGES[code];
    return NextResponse.json({ error: m.message, code }, { status: m.status });
  }
  console.error("[API] unhandled error:", e);
  return NextResponse.json({ error: "서버 오류가 발생했습니다. 다시 시도하거나 총괄에게 문의하세요." }, { status: 500 });
}

/**
 * 요청 JSON 본문. 파싱 실패만 400 으로 변환한다 — SyntaxError 를 전역으로 400 에 매핑하면
 * 서버 쪽 JSON.parse/RegExp 버그가 클라이언트 오류로 위장되므로(비평 반영) 이 헬퍼 안에서만 변환한다.
 */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError("요청 본문(JSON)이 올바르지 않습니다.");
  }
}

/**
 * 업로드(multipart) 본문. 선언 길이가 상한을 넘으면 파싱 전에 400, 파싱 실패(잘린 본문·비 multipart)도 400.
 * 파일 자체 크기·형식 검사는 호출측 assertUploadSize/매직바이트가 계속 담당한다.
 */
export async function readFormData(req: NextRequest): Promise<FormData> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > UPLOAD_MAX_BYTES + UPLOAD_MULTIPART_SLACK) {
    throw new ValidationError(
      `파일이 너무 큽니다 (${(declared / 1048576).toFixed(1)}MB). 최대 ${UPLOAD_MAX_BYTES / 1048576}MB — 시트를 나눠 올리세요.`,
    );
  }
  try {
    return await req.formData();
  } catch {
    throw new ValidationError("업로드 본문을 읽을 수 없습니다. 파일을 다시 선택해 올리세요.");
  }
}

type RouteContext = { params: Promise<Record<string, string>> };
type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response> | Response;

/**
 * 라우트 핸들러 래퍼. 핸들러 안에서 assert*(AuthzError)·검증(ValidationError)·DB 제약 예외를 그냥 던지면
 * apiErrorResponse 가 응답으로 바꾼다 — 라우트마다 try/catch 보일러플레이트를 두지 않는다.
 */
export function withApi<C = RouteContext>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      return apiErrorResponse(e);
    }
  };
}

// Next 라우트용 얇은 인가 어댑터. 순수 모듈 authz.ts(테스트 대상)와 분리한다.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { actorFromSession, AuthzError, type Actor, type MenuPerm } from "@/lib/authz";
import { ValidationError } from "@/lib/validation/input";

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
  // AuthzError 는 401/403 만 그대로 노출. 5xx 인 AuthzError(예: 안전하지 않은 scope 컴럼)는 개발자 오류이므로 일반 500 경로로(메시지 비노출).
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

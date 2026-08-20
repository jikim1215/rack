// Next 라우트용 얇은 인가 어댑터. 순수 모듈 authz.ts(테스트 대상)와 분리한다.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { actorFromSession, AuthzError, type Actor } from "@/lib/authz";

/** 현재 요청의 인가 주체 (미인증이면 null). */
export async function getActor(): Promise<Actor | null> {
  return actorFromSession(await getSession());
}

/** AuthzError를 적절한 401/403 응답으로 변환. 그 외 에러는 호출자에게 위임(null 반환). */
export function authzError(e: unknown): NextResponse | null {
  if (e instanceof AuthzError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return null;
}

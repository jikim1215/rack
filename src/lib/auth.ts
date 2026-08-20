// ── 세션 조회 + 서버측 폐기 검증 ──
// 무상태 HMAC 쿠키의 약점(발급 후 24h 폐기 불가)을 보완한다:
// 매 요청 getSession()에서 users.is_active와 users.token_version을 대조해
// 비활성화된 계정·비밀번호 변경 이전에 발급된 토큰을 즉시 무효화하고,
// role/team_id를 DB 값으로 덮어써 권한 강등·팀 변경을 즉시 반영한다. (경량 SQLite 조회 1회)
// 순수 로직(해시/토큰/정책)은 src/lib/auth-core.ts — 단위테스트 대상.
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE, verifySessionToken, type Role, type SessionPayload } from "./auth-core";

export * from "./auth-core";

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  try {
    const row = getDb()
      .prepare("SELECT is_active, token_version, role, team_id, must_change_password FROM users WHERE id = ?")
      .get(payload.userId) as
      | { is_active: number; token_version: number; role: string; team_id: number | null; must_change_password: number }
      | undefined;
    if (!row || !row.is_active) return null; // 삭제·비활성화 계정 즉시 차단
    if ((payload.tv ?? 0) !== (row.token_version ?? 0)) return null; // 비밀번호 변경 등으로 무효화된 토큰
    if (row.role !== "admin" && row.role !== "team" && row.role !== "viewer") return null; // 알 수 없는 역할은 거부
    // 토큰 발급 시점 값 대신 DB의 현재 role/team_id를 사용 (강등·팀 이동 즉시 반영)
    // 토큰 발급 시점 값 대신 DB의 현재 role/team_id/mcp를 사용 (강등·팀 이동·비번 초기화 즉시 반영)
    return { ...payload, role: row.role as Role, teamId: row.team_id ?? null, mcp: !!row.must_change_password };
  } catch {
    return null; // DB 접근 실패 시 default-deny
  }
}

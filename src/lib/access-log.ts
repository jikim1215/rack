// 접속(인증) 기록 (AC-19). 로그인 성공/실패/로그아웃을 access_logs에 보강 필드와 함께 남긴다.
// access_logs: user_id, username, ip, user_agent, action(login|logout|fail), result_code, failure_reason.
import type Database from "better-sqlite3";

export type AccessAction = "login" | "logout" | "fail";

export interface AccessLogParams {
  userId?: number | null;
  username?: string;
  ip?: string;
  userAgent?: string;
  action: AccessAction;
  resultCode?: string; // 예: "200", "401", "429"
  failureReason?: string; // 예: "invalid_credentials", "rate_limited", "locked"
}

export function logAccess(db: Database.Database, p: AccessLogParams): void {
  db.prepare(
    `INSERT INTO access_logs (user_id, username, ip, user_agent, action, result_code, failure_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.userId ?? null,
    p.username ?? "",
    p.ip ?? "",
    p.userAgent ?? "",
    p.action,
    p.resultCode ?? "",
    p.failureReason ?? "",
  );
}

/**
 * 요청에서 클라이언트 IP / User-Agent 추출.
 * X-Forwarded-For/X-Real-IP는 스푸핑 가능한 헤더이므로 TRUST_PROXY=true(신뢰할 수 있는
 * 역프록시 뒤에 배치된 경우)일 때만 신뢰한다. 그 외에는 "direct"로 기록해
 * 위조 헤더로 rate-limit 키·접근로그를 오염시키는 것을 차단한다.
 */
export function clientMeta(req: Request): { ip: string; userAgent: string } {
  const userAgent = req.headers.get("user-agent") || "";
  if (process.env.TRUST_PROXY === "true") {
    const xff = req.headers.get("x-forwarded-for") || "";
    const ip = xff.split(",")[0].trim() || req.headers.get("x-real-ip") || "direct";
    return { ip, userAgent };
  }
  return { ip: "direct", userAgent };
}

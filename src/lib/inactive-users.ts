// 장기 미사용 계정 비활성화 — 마지막 활동 후 6개월이 지난 활성 계정을 is_active=0 으로 잠근다(삭제 아님, 재활성 가능).
// 실행 경로 두 개가 같은 함수를 쓴다:
//   - 매일 03:30 유지보수 타이머(scripts/deploy/retention-runner.ts) — changedBy 'system'
//   - 총괄의 수동 점검(설정 → 사용자 관리 → 장기 미사용 점검, POST /api/users/inactive)
// "마지막 활동" 기준 = 마지막 로그인 · 계정 생성 · 재활성화 중 가장 늦은 시각.
//   - 한 번도 로그인하지 않은 계정(일괄 등록 등)은 생성일부터 센다.
//   - 총괄이 다시 활성화하면 그 시각부터 센다 — 안 그러면 마지막 로그인이 여전히 6개월 전이라 다음 날 또 잠긴다.
// 마지막 활성 총괄은 대상에서 뺀다(전원 잠기면 아무도 관리 화면에 들어갈 수 없다).
// 시각은 모두 SQLite datetime('now','localtime') 형식 'YYYY-MM-DD HH:MM:SS' — 문자열 비교가 곧 시각 비교.
import type Database from "better-sqlite3";
import { logAudit } from "./audit.ts";
import { wouldRemoveLastAdmin } from "./user-admin.ts";

export const INACTIVE_MONTHS = 6;

/** 계정의 마지막 활동 시각 SQL 식 (users 테이블 컬럼 기준). NULL 은 빈 문자열로 접어 MAX 가 NULL 이 되지 않게 한다. */
export const LAST_ACTIVITY_SQL =
  "MAX(COALESCE(last_login_at, ''), COALESCE(created_at, ''), COALESCE(reactivated_at, ''))";

/** 사용자 목록(설정 화면 초기 렌더 · GET /api/users) 공용 컬럼 — 두 경로가 같은 모양을 돌려주게 한 곳에 둔다. */
export const USER_LIST_COLUMNS =
  `id, username, display_name, role, team_id, is_active, must_change_password, allowed_ips, totp_enabled, created_at, last_login_at, ${LAST_ACTIVITY_SQL} AS last_activity`;

export interface InactiveCandidate {
  id: number;
  username: string;
  display_name: string;
  role: string;
  last_login_at: string | null;
  last_activity: string;
}

/** 로그인 성공 시각 기록 — 비밀번호 단계(2단계 인증 미사용)와 2단계 인증 성공 지점에서 부른다. */
export function recordLogin(db: Database.Database, userId: number): void {
  db.prepare("UPDATE users SET last_login_at = datetime('now','localtime') WHERE id = ?").run(userId);
}

/** 기준 시각(이보다 마지막 활동이 이르면 대상). */
export function inactiveCutoff(db: Database.Database, months = INACTIVE_MONTHS): string {
  return (db.prepare(`SELECT datetime('now', '-${Math.floor(months)} months', 'localtime') AS c`).get() as { c: string }).c;
}

/** 비활성화 대상 목록 (마지막 활동이 오래된 순). 마지막 활성 총괄 보호가 이미 반영돼 있다. */
export function findInactiveUsers(db: Database.Database, months = INACTIVE_MONTHS): InactiveCandidate[] {
  const cutoff = inactiveCutoff(db, months);
  const rows = db.prepare(
    `SELECT id, username, display_name, role, last_login_at, ${LAST_ACTIVITY_SQL} AS last_activity
       FROM users WHERE is_active = 1 AND ${LAST_ACTIVITY_SQL} < ?
      ORDER BY last_activity, id`,
  ).all(cutoff) as InactiveCandidate[];

  // 대상에 든 총괄을 오래된 순으로 하나씩 빼 보며, 활성 총괄이 0명이 되는 순간의 그 총괄(=가장 최근에 활동한 총괄)은 남긴다.
  const activeAdmins = (db.prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all() as { id: number }[])
    .map((r) => r.id);
  const keep = new Set<number>();
  let remaining = activeAdmins;
  for (const c of rows) {
    if (c.role !== "admin") continue;
    if (wouldRemoveLastAdmin(remaining, c.id, false)) keep.add(c.id);
    else remaining = remaining.filter((id) => id !== c.id);
  }
  return rows.filter((r) => !keep.has(r.id));
}

/**
 * 대상 계정을 비활성화(is_active=0, 기존 세션 무효화)하고 계정마다 감사로그를 남긴다. 한 트랜잭션.
 * @returns 비활성화한 계정 목록
 */
export function deactivateInactiveUsers(db: Database.Database, changedBy: string, months = INACTIVE_MONTHS): InactiveCandidate[] {
  return db.transaction(() => {
    const targets = findInactiveUsers(db, months);
    const upd = db.prepare("UPDATE users SET is_active = 0, token_version = COALESCE(token_version, 0) + 1 WHERE id = ? AND is_active = 1");
    for (const t of targets) {
      upd.run(t.id);
      logAudit(db, {
        entityType: "user",
        entityId: t.id,
        entityName: t.username,
        action: "update",
        changedBy,
        oldData: { is_active: 1, deactivated_reason: "" },
        newData: { is_active: 0, deactivated_reason: `장기 미사용(${months}개월) — 마지막 활동 ${t.last_activity}` },
      });
    }
    return targets;
  })();
}

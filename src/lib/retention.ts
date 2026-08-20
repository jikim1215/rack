// 로그 보존/프루닝 (AC-20). 감사로그/접속기록을 1년(기본 365일) 초과분만 삭제한다.
// audit_logs는 append-only 트리거로 1년 이내 행 삭제가 차단되므로, 프루닝은 1년 초과분만 안전하게 삭제.
// 백업과의 동시 실행을 막기 위해 공용 lockfile로 상호배제한다(백업도 동일 lock 사용).
import type Database from "better-sqlite3";
import { existsSync, mkdirSync, openSync, closeSync, unlinkSync, writeSync, statSync } from "fs";
import { dirname } from "path";

export const RETENTION_DAYS = 365;
// 스테일 락 임계값: 정상 작업(백업/프루닝)은 수 분 내 종료 → 1시간 초과 lockfile은 비정상 잔존으로 간주.
export const STALE_LOCK_MS = 60 * 60 * 1000;

export interface PruneResult {
  auditDeleted: number;
  accessDeleted: number;
  cutoff: string;
}

/** 1년(또는 지정일) 초과 audit_logs/access_logs 삭제. created_at 은 'YYYY-MM-DD HH:MM:SS' localtime. */
export function pruneOldLogs(db: Database.Database, olderThanDays = RETENTION_DAYS): PruneResult {
  // append-only 트리거가 1년 미만 audit 삭제를 ABORT하므로 보존 창은 365일 미만으로 내려갈 수 없다(클램프하여 throw 방지).
  const days = Math.max(RETENTION_DAYS, Math.floor(olderThanDays));
  const cutoffExpr = `datetime('now', '-${days} days', 'localtime')`;
  const cutoff = (db.prepare(`SELECT ${cutoffExpr} AS c`).get() as { c: string }).c;
  // append-only 트리거가 1년 이내 audit 삭제를 막으므로, 1년 초과분만 삭제(트리거 통과)
  const audit = db.prepare(`DELETE FROM audit_logs WHERE created_at < ?`).run(cutoff);
  const access = db.prepare(`DELETE FROM access_logs WHERE created_at < ?`).run(cutoff);
  return { auditDeleted: audit.changes, accessDeleted: access.changes, cutoff };
}

/**
 * 공용 lockfile 상호배제. 백업/프루닝이 동시에 DB를 건드리지 않도록 한다.
 * 락 획득 실패(이미 점유 중) 시 false 반환(작업 건너뜀) — 다음 타이머 주기에 재시도.
 */
export function withLock<T>(lockPath: string, fn: () => T): { ran: boolean; result?: T } {
  const dir = dirname(lockPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // 스테일 락 회수: 비정상 종료로 남은 오래된(STALE_LOCK_MS 초과) lockfile은 제거 후 재획득 (영구 차단 방지).
  try {
    if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
      unlinkSync(lockPath);
    }
  } catch { /* best-effort */ }
  let fd: number;
  try {
    // wx: 이미 존재하면 실패 → 다른 작업이 점유 중
    fd = openSync(lockPath, "wx");
  } catch {
    return { ran: false };
  }
  try {
    writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
    const result = fn();
    return { ran: true, result };
  } finally {
    closeSync(fd);
    try { unlinkSync(lockPath); } catch { /* best-effort */ }
  }
}

export const DEFAULT_LOCK_PATH = "/var/lib/asset-inventory/maintenance.lock";

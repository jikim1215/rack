#!/bin/bash
# ============================================================
# DB 백업 스크립트 (AC-20/AC-21)
# - 로그 보존 프루닝(retention-runner)과 공용 lockfile로 상호배제
#   (retention.ts withLock 과 동일한 "존재 기반" 락: 파일이 있으면 점유 중)
# - 백업 파일 권한 600, WAL 안전 online backup, N일 초과 정리
# systemd: asset-backup.timer 가 호출 (또는 cron)
# ============================================================
set -euo pipefail

APP_DIR="${ASSET_DB_CWD:-/opt/asset-inventory}"
BACKUP_DIR="${APP_DIR}/backups"
DB_FILE="${APP_DIR}/data.db"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
LOCK_PATH="${ASSET_LOCK_PATH:-/var/lib/asset-inventory/maintenance.lock}"

mkdir -p "$(dirname "$LOCK_PATH")"

# 스테일 락 회수: 비정상 종료로 1시간 초과 잔존한 lockfile 제거 (retention STALE_LOCK_MS와 동일 정책, 영구 차단 방지)
if [[ -f "$LOCK_PATH" ]] && find "$LOCK_PATH" -mmin +60 2>/dev/null | grep -q .; then
  rm -f "$LOCK_PATH"
fi
# 존재 기반 상호배제: noclobber 로 원자적 생성, 이미 있으면 프루닝 등 다른 유지보수 진행 중 → 건너뜀
if ! ( set -o noclobber; echo "$$ $(date -Iseconds)" > "$LOCK_PATH" ) 2>/dev/null; then
  echo "[SKIP] maintenance lock 점유 중(${LOCK_PATH}); 프루닝 등 진행 중 — 백업 건너뜀"
  exit 0
fi
# 종료 시 락 해제 (정상/오류/시그널 모두)
trap 'rm -f "$LOCK_PATH"' EXIT INT TERM

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" || true

if [[ ! -f "$DB_FILE" ]]; then
  echo "[ERROR] DB 파일이 없습니다: ${DB_FILE}"
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/data.db.${TIMESTAMP}.gz"

# 번들 better-sqlite3 online backup + gzip (sqlite3 CLI 의존 제거, 폐쇄망 최소설치 대응)
NODE="${ASSET_NODE:-${APP_DIR}/node/bin/node}"
[[ -x "$NODE" ]] || NODE="node"
( cd "$APP_DIR" && "$NODE" "${APP_DIR}/scripts/deploy/db-backup.mjs" "$DB_FILE" "$BACKUP_FILE" )

echo "[OK] 백업 완료: ${BACKUP_FILE} (권한 600)"

# 오래된 백업 삭제
find "$BACKUP_DIR" -name "data.db.*.gz" -mtime "+${KEEP_DAYS}" -delete
echo "[OK] ${KEEP_DAYS}일 이전 백업 정리 완료"

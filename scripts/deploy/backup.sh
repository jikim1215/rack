#!/bin/bash
# ============================================================
# DB 백업 스크립트
# cron 등록 예시: 0 2 * * * /opt/rack-asset-manager/scripts/deploy/backup.sh
# ============================================================
set -euo pipefail

APP_DIR="/opt/rack-asset-manager"
BACKUP_DIR="${APP_DIR}/backups"
DB_FILE="${APP_DIR}/data.db"
KEEP_DAYS=30

mkdir -p "$BACKUP_DIR"

if [[ ! -f "$DB_FILE" ]]; then
  echo "[ERROR] DB 파일이 없습니다: ${DB_FILE}"
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/data.db.${TIMESTAMP}"

# SQLite online backup (WAL 모드 안전)
sqlite3 "$DB_FILE" ".backup '${BACKUP_FILE}'"
gzip "${BACKUP_FILE}"

echo "[OK] 백업 완료: ${BACKUP_FILE}.gz"

# 오래된 백업 삭제
find "$BACKUP_DIR" -name "data.db.*.gz" -mtime +${KEEP_DAYS} -delete
echo "[OK] ${KEEP_DAYS}일 이전 백업 정리 완료"

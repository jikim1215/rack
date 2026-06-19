#!/bin/bash
# ============================================================
# DB 복원 스크립트
# 사용법: sudo bash restore.sh /opt/rack-asset-manager/backups/data.db.20260619_020000.gz
# ============================================================
set -euo pipefail

APP_NAME="rack-asset-manager"
APP_DIR="/opt/${APP_NAME}"
DB_FILE="${APP_DIR}/data.db"

if [[ $# -lt 1 ]]; then
  echo "사용법: $0 <백업파일.gz>"
  echo ""
  echo "사용 가능한 백업:"
  ls -la "${APP_DIR}/backups/"*.gz 2>/dev/null || echo "  (백업 없음)"
  exit 1
fi

BACKUP="$1"
if [[ ! -f "$BACKUP" ]]; then
  echo "[ERROR] 파일을 찾을 수 없습니다: ${BACKUP}"
  exit 1
fi

echo "[INFO] 서비스 중지..."
systemctl stop ${APP_NAME}

echo "[INFO] 현재 DB 백업..."
cp "$DB_FILE" "${DB_FILE}.pre-restore.$(date +%Y%m%d_%H%M%S)"

echo "[INFO] 복원 중: ${BACKUP}"
gunzip -c "$BACKUP" > "$DB_FILE"
chown rackapp:rackapp "$DB_FILE"
chmod 600 "$DB_FILE"

echo "[INFO] 서비스 재시작..."
systemctl start ${APP_NAME}

echo "[OK] 복원 완료"

#!/bin/bash
# ============================================================
# DB 복원 + 복구 리허설 (AC-22)
# 복원:   sudo bash restore.sh <backup.gz>
# 리허설: bash restore.sh --rehearse <backup.gz>   (서비스/실DB 무중단, 임시 복원 후 무결성 검증만)
# ============================================================
set -euo pipefail

APP_NAME="asset-inventory"
APP_DIR="${ASSET_APP_DIR:-/opt/${APP_NAME}}"
DB_FILE="${APP_DIR}/data.db"
APP_USER="asset"
NODE="${ASSET_NODE:-${APP_DIR}/node/bin/node}"; [[ -x "$NODE" ]] || NODE="node"

REHEARSE=0
if [[ "${1:-}" == "--rehearse" ]]; then REHEARSE=1; shift; fi

if [[ $# -lt 1 ]]; then
  echo "사용법: $0 [--rehearse] <백업파일.gz>"
  ls -la "${APP_DIR}/backups/"*.gz 2>/dev/null || echo "  (백업 없음)"
  exit 1
fi
BACKUP="$1"
[[ -f "$BACKUP" ]] || { echo "[ERROR] 백업 파일 없음: ${BACKUP}"; exit 1; }

# 무결성 검증 헬퍼: 번들 better-sqlite3로 integrity_check + assets 조회 (sqlite3 CLI 의존 제거)
verify_db() {
  ( cd "$APP_DIR" && "$NODE" "${APP_DIR}/scripts/deploy/db-verify.mjs" "$1" )
}

if [[ "$REHEARSE" == "1" ]]; then
  # 리허설: 실 서비스/DB 무중단, 임시 디렉터리에 복원 후 검증만
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  echo "[리허설] ${BACKUP} → ${TMP}/data.db 임시 복원 + 검증 (실DB/서비스 무중단)"
  gunzip -c "$BACKUP" > "${TMP}/data.db"
  verify_db "${TMP}/data.db"
  echo "[OK] 복구 리허설 통과 — 이 백업으로 실복원 가능"
  exit 0
fi

# 실제 복원 (서비스 중지 → pre-restore 백업 → 복원 → 검증 → 재시작)
[[ $(id -u) -eq 0 ]] || { echo "[ERROR] 실복원은 root 필요"; exit 1; }
systemctl stop ${APP_NAME}
[[ -f "$DB_FILE" ]] && cp "$DB_FILE" "${DB_FILE}.pre-restore.$(date +%Y%m%d_%H%M%S)"
# 잔존 WAL/SHM 제거 — 남겨두면 복원본 위에 구 WAL 프레임이 재생되어 복원이 침묵 취소될 수 있다 (R2 비평 반영)
rm -f "${DB_FILE}-wal" "${DB_FILE}-shm"
gunzip -c "$BACKUP" > "$DB_FILE"
chown "${APP_USER}:${APP_USER}" "$DB_FILE"; chmod 600 "$DB_FILE"
verify_db "$DB_FILE" || { echo "[ERROR] 복원본 검증 실패 — 서비스 미기동"; exit 1; }
systemctl start ${APP_NAME}
echo "[OK] 복원 완료"

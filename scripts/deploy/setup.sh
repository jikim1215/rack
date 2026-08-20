#!/bin/bash
# ============================================================
# asset-inventory 오프라인 설치 (Rocky Linux 8.10, x86_64) — Node 내장 TLS HTTPS
# 사용법: sudo bash setup.sh
# AC-15/16/21/22: OS-only 오프라인, self-signed TLS(키600), systemd 자동기동, HTTP→HTTPS, native smoke
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${ASSET_APP_DIR:-/opt/asset-inventory}"
# 번들 루트 = 추출된 asset-inventory/ (scripts/deploy의 두 단계 위). build-release.sh가 만든 플랫 트리와 일치.
BUNDLE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
NODE_DIR="${APP_DIR}/node"
APP_NAME="asset-inventory"
APP_USER="asset"
HTTPS_PORT="${HTTPS_PORT:-443}"
HTTP_PORT="${HTTP_PORT:-80}"
NEXT_INTERNAL_PORT="${NEXT_INTERNAL_PORT:-3000}"
TLS_DIR="${APP_DIR}/tls"
LOCK_DIR="/var/lib/${APP_NAME}"

[[ $(id -u) -eq 0 ]] || { echo "[ERROR] root 필요: sudo bash setup.sh"; exit 1; }

echo "== ${APP_NAME} 오프라인 설치 (HTTPS) =="

# ── 1. 앱 + 번들 Node 배치 ──
mkdir -p "$APP_DIR" "$TLS_DIR" "$LOCK_DIR"
if [[ "$BUNDLE_ROOT" != "$APP_DIR" ]]; then
  cp -a "${BUNDLE_ROOT}/." "$APP_DIR/"
fi
if [[ ! -x "${NODE_DIR}/bin/node" ]]; then
  NODE_TAR="${BUNDLE_ROOT}/node-linux-x64.tar.xz"
  [[ -f "$NODE_TAR" ]] || NODE_TAR="${APP_DIR}/node-linux-x64.tar.xz"
  [[ -f "$NODE_TAR" ]] || { echo "[ERROR] 번들 Node(${NODE_TAR}) 없음 — build-release.sh가 동봉했는지 확인"; exit 1; }
  mkdir -p "$NODE_DIR"; tar -xf "$NODE_TAR" -C "$NODE_DIR" --strip-components=1
fi
NODE="${NODE_DIR}/bin/node"
echo "[OK] Node $($NODE -v)"
# Node >= 22.6 단언 (retention-runner/import-asset-final이 --experimental-strip-types로 .ts 실행, AC-20/24)
NODE_MAJOR=$("$NODE" -e "console.log(process.versions.node.split('.')[0])")
NODE_MINOR=$("$NODE" -e "console.log(process.versions.node.split('.')[1])")
if (( NODE_MAJOR < 22 || (NODE_MAJOR == 22 && NODE_MINOR < 6) )); then
  echo "[ERROR] 번들 Node $($NODE -v) < 22.6 — --experimental-strip-types(.ts 실행) 미지원. Node 22.6+ 번들 필요."
  exit 1
fi

# ── 2. 서비스 계정 ──
id "$APP_USER" &>/dev/null || useradd -r -s /sbin/nologin "$APP_USER"

# ── 3. native(better-sqlite3) smoke (AC-16: native 로드 검증, 실패 시 Plan B 안내) ──
STANDALONE_BS="${APP_DIR}/.next/standalone/node_modules/better-sqlite3"
[[ -d "$STANDALONE_BS" ]] || STANDALONE_BS="${APP_DIR}/node_modules/better-sqlite3"
if ! "$NODE" -e "require('${STANDALONE_BS}'); console.log('native ok')"; then
  echo "[WARN] better-sqlite3 native 로드 실패 — Plan B(소스 리빌드) 시도"
  bash "${APP_DIR}/scripts/deploy/native-planb.sh" || { echo "[ERROR] Plan B 실패. gcc/make/python3 설치 후 재시도."; exit 1; }
  "$NODE" -e "require('${STANDALONE_BS}'); console.log('native ok(planb)')" || { echo "[ERROR] Plan B 후에도 native 로드 실패"; exit 1; }
fi
echo "[OK] better-sqlite3 native smoke 통과"

# ── 4. self-signed TLS 인증서 (키 권한 600, AC-21) ──
if [[ ! -f "${TLS_DIR}/key.pem" || ! -f "${TLS_DIR}/cert.pem" ]]; then
  HOST_CN="$(hostname -f 2>/dev/null || hostname)"
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout "${TLS_DIR}/key.pem" -out "${TLS_DIR}/cert.pem" \
    -subj "/CN=${HOST_CN}" -addext "subjectAltName=DNS:${HOST_CN},IP:$(hostname -I | awk '{print $1}')" 2>/dev/null
  echo "[OK] self-signed 인증서 생성 (CN=${HOST_CN})"
fi
chmod 600 "${TLS_DIR}/key.pem"
chmod 644 "${TLS_DIR}/cert.pem"

# ── 5. .env (AUTH_SECRET 강제, COOKIE_SECURE=true) ──
if [[ ! -f "${APP_DIR}/.env" ]]; then
  SECRET=$("$NODE" -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
  cat > "${APP_DIR}/.env" <<ENVEOF
NEXT_TELEMETRY_DISABLED=1
NODE_ENV=production
AUTH_SECRET=${SECRET}
COOKIE_SECURE=true
HTTPS_PORT=${HTTPS_PORT}
HTTP_PORT=${HTTP_PORT}
NEXT_INTERNAL_PORT=${NEXT_INTERNAL_PORT}
TLS_KEY_PATH=${TLS_DIR}/key.pem
TLS_CERT_PATH=${TLS_DIR}/cert.pem
NEXT_SERVER=${APP_DIR}/.next/standalone/server.js
ASSET_DB_CWD=${APP_DIR}
ASSET_DB_PATH=${APP_DIR}/data.db
ASSET_LOCK_PATH=${LOCK_DIR}/maintenance.lock
# 타임존 고정 — 로그 시각을 서버 OS 무관하게 KST로 기록
TZ=Asia/Seoul
ENVEOF
  echo "[OK] .env 생성 (COOKIE_SECURE=true)"
fi

# ── 6. DB 초기화 (스키마는 앱 첫 기동 시 getDb가 마이그레이션; 운영 데이터는 import-asset-final로 이관) ──
chown -R "${APP_USER}:${APP_USER}" "$APP_DIR" "$LOCK_DIR"
chmod 600 "${APP_DIR}/.env"
[[ -f "${APP_DIR}/data.db" ]] && chmod 600 "${APP_DIR}/data.db" || true

# ── 7. systemd (서버: server-tls.mjs = TLS 종단 + 내부 Next + HTTP→HTTPS) ──
cat > /etc/systemd/system/${APP_NAME}.service <<SVCEOF
[Unit]
Description=정보시스템 자산관리 (HTTPS, Node 내장 TLS)
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
# 443/80 바인드를 위한 권한(루트 미사용)
AmbientCapabilities=CAP_NET_BIND_SERVICE
ExecStart=${NODE} ${APP_DIR}/scripts/deploy/server-tls.mjs
Restart=always
RestartSec=10
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${APP_DIR} ${LOCK_DIR}
PrivateTmp=true
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SVCEOF

# ── 8. 보존 프루닝 + 백업 타이머 설치 (AC-20/22) ──
for unit in asset-retention.service asset-retention.timer asset-backup.service asset-backup.timer; do
  [[ -f "${APP_DIR}/scripts/deploy/${unit}" ]] && cp "${APP_DIR}/scripts/deploy/${unit}" /etc/systemd/system/${unit}
done

# ── 9. 방화벽 (80/443) + SELinux ──
if command -v firewall-cmd &>/dev/null; then
  firewall-cmd --permanent --add-port=${HTTPS_PORT}/tcp 2>/dev/null || true
  firewall-cmd --permanent --add-port=${HTTP_PORT}/tcp 2>/dev/null || true
  firewall-cmd --reload 2>/dev/null || true
fi

# ── 10. 기동 + HTTPS/리다이렉트 native smoke ──
systemctl daemon-reload
systemctl enable --now ${APP_NAME}
systemctl enable --now asset-retention.timer 2>/dev/null || true
systemctl enable --now asset-backup.timer 2>/dev/null || true
sleep 4
IP="$(hostname -I | awk '{print $1}')"
if curl -sk "https://localhost:${HTTPS_PORT}/login" -o /dev/null -w '%{http_code}' | grep -q '200\|302\|307'; then
  echo "[OK] HTTPS native smoke 통과"
else
  echo "[WARN] HTTPS smoke 미확인 — journalctl -u ${APP_NAME} 확인"
fi
echo "== 설치 완료: https://${IP}:${HTTPS_PORT} (HTTP→HTTPS 자동), 초기 admin@example.go.kr / admin123 (변경 필수) =="

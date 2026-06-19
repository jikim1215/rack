#!/bin/bash
# ============================================================
# rack-asset-manager 포터블 설치 스크립트
# 대상: Rocky Linux 8.10 (Intel x86_64)
# 사용법: sudo bash setup.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="${SCRIPT_DIR}/app"
NODE_VER="20.18.1"
APP_PORT=3000
APP_NAME="rack-asset-manager"
APP_USER="rackapp"

echo "=========================================="
echo " ${APP_NAME} 포터블 설치"
echo "=========================================="

if [[ $(id -u) -ne 0 ]]; then
  echo "[ERROR] root 권한 필요: sudo bash setup.sh"
  exit 1
fi

# ── 1. Node.js 설치 ──
if command -v node &>/dev/null && [[ "$(node -v)" == v20* ]]; then
  echo "[INFO] Node.js $(node -v) 이미 설치됨"
else
  NODE_TAR="${SCRIPT_DIR}/node-v${NODE_VER}-linux-x64.tar.xz"
  if [[ ! -f "$NODE_TAR" ]]; then
    echo "[ERROR] ${NODE_TAR} 파일이 없습니다."
    exit 1
  fi
  echo "[INFO] Node.js v${NODE_VER} 설치..."
  tar -xf "$NODE_TAR" -C /usr/local --strip-components=1
  echo "[OK] Node.js $(node -v)"
fi

# ── 2. 서비스 계정 ──
if ! id "$APP_USER" &>/dev/null; then
  useradd -r -s /sbin/nologin "$APP_USER"
  echo "[OK] 서비스 계정 '${APP_USER}' 생성"
fi

# ── 3. .env 생성 ──
if [[ ! -f "${APP_DIR}/.env" ]]; then
  SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
  cat > "${APP_DIR}/.env" << ENVEOF
NEXT_TELEMETRY_DISABLED=1
HOSTNAME=0.0.0.0
PORT=${APP_PORT}
AUTH_SECRET=${SECRET}
ENVEOF
  echo "[OK] .env 생성"
fi

# ── 4. DB 초기화 ──
if [[ ! -f "${APP_DIR}/data.db" ]]; then
  echo "[INFO] DB 초기화..."
  cd "$APP_DIR"
  node scripts/db-seed.mjs
  echo "[OK] DB 초기화 완료 (시드 데이터 포함)"
fi

# ── 5. 권한 ──
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
chmod 600 "${APP_DIR}/.env"
chmod 600 "${APP_DIR}/data.db" 2>/dev/null || true

# ── 6. systemd ──
cat > /etc/systemd/system/${APP_NAME}.service << SVCEOF
[Unit]
Description=IT자산관리 시스템
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=$(which node) server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=${APP_DIR}/.env

NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${APP_DIR}
PrivateTmp=true
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SVCEOF

# ── 7. 방화벽 ──
if command -v firewall-cmd &>/dev/null; then
  firewall-cmd --permanent --add-port=${APP_PORT}/tcp 2>/dev/null || true
  firewall-cmd --reload 2>/dev/null || true
  echo "[OK] 방화벽 포트 ${APP_PORT} 개방"
fi

# ── 8. SELinux ──
if command -v setsebool &>/dev/null; then
  setsebool -P httpd_can_network_connect 1 2>/dev/null || true
fi

# ── 9. 시작 ──
systemctl daemon-reload
systemctl enable ${APP_NAME}
systemctl restart ${APP_NAME}

# ── 10. start/stop 스크립트 생성 ──
cat > "${SCRIPT_DIR}/start.sh" << 'STARTEOF'
#!/bin/bash
sudo systemctl start rack-asset-manager
echo "서비스 시작됨: http://$(hostname -I | awk '{print $1}'):3000"
STARTEOF

cat > "${SCRIPT_DIR}/stop.sh" << 'STOPEOF'
#!/bin/bash
sudo systemctl stop rack-asset-manager
echo "서비스 중지됨"
STOPEOF

chmod +x "${SCRIPT_DIR}/start.sh" "${SCRIPT_DIR}/stop.sh"

echo ""
echo "=========================================="
echo " 설치 완료!"
echo "=========================================="
echo ""
echo " URL:  http://$(hostname -I | awk '{print $1}'):${APP_PORT}"
echo " 계정: admin / admin123!"
echo ""
echo " 명령어:"
echo "   ./start.sh     서비스 시작"
echo "   ./stop.sh      서비스 중지"
echo "   systemctl status ${APP_NAME}     상태 확인"
echo "   journalctl -u ${APP_NAME} -f     로그"
echo ""
echo " ⚠ 첫 로그인 후 비밀번호를 변경하세요!"
echo "=========================================="

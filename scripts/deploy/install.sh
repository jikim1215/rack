#!/bin/bash
# ============================================================
# rack-asset-manager 폐쇄망 설치 스크립트
# 대상: Rocky Linux 8.10 (Intel x86_64)
# ============================================================
set -euo pipefail

APP_NAME="rack-asset-manager"
APP_DIR="/opt/${APP_NAME}"
APP_USER="rackapp"
APP_PORT=3000
NODE_VER="20.18.1"

echo "=========================================="
echo " ${APP_NAME} 설치 시작"
echo "=========================================="

# ── 1. 사전 조건 확인 ──
if [[ $(id -u) -ne 0 ]]; then
  echo "[ERROR] root 권한으로 실행하세요: sudo bash install.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 2. Node.js 설치 (이미 설치된 경우 건너뜀) ──
if command -v node &>/dev/null; then
  echo "[INFO] Node.js 이미 설치됨: $(node -v)"
else
  NODE_TAR="${SCRIPT_DIR}/node-v${NODE_VER}-linux-x64.tar.xz"
  if [[ ! -f "$NODE_TAR" ]]; then
    echo "[ERROR] Node.js 바이너리를 찾을 수 없습니다: ${NODE_TAR}"
    echo "        인터넷 PC에서 다운로드 후 이 디렉터리에 복사하세요:"
    echo "        https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-x64.tar.xz"
    exit 1
  fi
  echo "[INFO] Node.js v${NODE_VER} 설치 중..."
  tar -xf "$NODE_TAR" -C /usr/local --strip-components=1
  echo "[OK] Node.js $(node -v) 설치 완료"
fi

# ── 3. 서비스 계정 생성 ──
if ! id "$APP_USER" &>/dev/null; then
  useradd -r -s /sbin/nologin -d "$APP_DIR" "$APP_USER"
  echo "[OK] 서비스 계정 '${APP_USER}' 생성"
else
  echo "[INFO] 서비스 계정 '${APP_USER}' 이미 존재"
fi

# ── 4. 애플리케이션 배포 ──
echo "[INFO] 애플리케이션 배포: ${APP_DIR}"
mkdir -p "$APP_DIR"

# 기존 DB 백업
if [[ -f "${APP_DIR}/data.db" ]]; then
  BACKUP="${APP_DIR}/data.db.backup.$(date +%Y%m%d_%H%M%S)"
  cp "${APP_DIR}/data.db" "$BACKUP"
  echo "[OK] 기존 DB 백업: ${BACKUP}"
fi

# 앱 파일 복사 (release 디렉터리에서)
RELEASE_TAR="${SCRIPT_DIR}/rack-release.tar.gz"
if [[ -f "$RELEASE_TAR" ]]; then
  tar -xzf "$RELEASE_TAR" -C "$APP_DIR" --strip-components=1
  echo "[OK] 릴리스 압축 해제 완료"
else
  echo "[ERROR] 릴리스 파일을 찾을 수 없습니다: ${RELEASE_TAR}"
  echo "        빌드 PC에서 npm run build:release 실행 후 rack-release.tar.gz를 복사하세요"
  exit 1
fi

# ── 4-1. better-sqlite3 네이티브 바인딩 재빌드 (Windows 빌드 타르볼인 경우) ──
BINDING="${APP_DIR}/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
if [[ -f "$BINDING" ]]; then
  # 바인딩이 Linux용인지 확인
  FILE_TYPE=$(file "$BINDING" 2>/dev/null || echo "unknown")
  if echo "$FILE_TYPE" | grep -q "ELF.*x86-64"; then
    echo "[INFO] better-sqlite3 네이티브 바인딩: Linux x64 확인됨 — 재빌드 불필요"
  else
    echo "[INFO] better-sqlite3 네이티브 바인딩이 Linux용이 아닙니다. 재빌드 중..."
    if ! command -v make &>/dev/null || ! command -v gcc &>/dev/null; then
      echo "[WARN] 빌드 도구가 없습니다. 설치 중..."
      dnf groupinstall -y "Development Tools" 2>/dev/null || yum groupinstall -y "Development Tools"
      dnf install -y python3 2>/dev/null || yum install -y python3
    fi
    cd "$APP_DIR"
    npm rebuild better-sqlite3
    echo "[OK] better-sqlite3 재빌드 완료"
  fi
else
  echo "[WARN] better-sqlite3 바인딩 파일 없음 — 빌드 시도..."
  cd "$APP_DIR"
  npm rebuild better-sqlite3
fi

# ── 5. 환경 설정 ──
if [[ ! -f "${APP_DIR}/.env" ]]; then
  # 새 시크릿 생성
  SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
  cat > "${APP_DIR}/.env" << EOF
# 폐쇄망 환경 설정
NEXT_TELEMETRY_DISABLED=1
PORT=${APP_PORT}

# 인증 시크릿 (자동 생성됨)
AUTH_SECRET=${SECRET}
EOF
  echo "[OK] .env 생성 (신규 시크릿)"
else
  echo "[INFO] .env 이미 존재 — 기존 설정 유지"
fi

# ── 6. DB 초기화 (첫 설치 시) ──
if [[ ! -f "${APP_DIR}/data.db" ]]; then
  echo "[INFO] DB 초기화 + 시드 데이터 투입..."
  cd "$APP_DIR"
  node scripts/db-seed.mjs
  echo "[OK] DB 초기화 완료"
fi

# ── 7. 권한 설정 ──
chown -R "${APP_USER}:${APP_USER}" "$APP_DIR"
chmod 600 "${APP_DIR}/.env"
chmod 600 "${APP_DIR}/data.db" 2>/dev/null || true

# ── 8. systemd 서비스 등록 ──
cat > /etc/systemd/system/${APP_NAME}.service << EOF
[Unit]
Description=IT자산관리 시스템 (${APP_NAME})
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=$(which node) node_modules/next/dist/bin/next start -p ${APP_PORT}
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=${APP_DIR}/.env

# 보안 강화
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${APP_DIR}
PrivateTmp=true

# 리소스 제한
LimitNOFILE=65536
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF

# ── 9. 방화벽 포트 개방 ──
if command -v firewall-cmd &>/dev/null; then
  firewall-cmd --permanent --add-port=${APP_PORT}/tcp 2>/dev/null || true
  firewall-cmd --reload 2>/dev/null || true
  echo "[OK] 방화벽 포트 ${APP_PORT} 개방"
fi

# ── 10. SELinux 허용 (필요 시) ──
if command -v setsebool &>/dev/null; then
  setsebool -P httpd_can_network_connect 1 2>/dev/null || true
fi

systemctl daemon-reload
systemctl enable ${APP_NAME}
systemctl restart ${APP_NAME}

echo ""
echo "=========================================="
echo " 설치 완료!"
echo "=========================================="
echo ""
echo " 접속 URL:  http://$(hostname -I | awk '{print $1}'):${APP_PORT}"
echo " 기본 계정: admin / admin123!"
echo ""
echo " 서비스 관리:"
echo "   상태 확인:  systemctl status ${APP_NAME}"
echo "   로그 확인:  journalctl -u ${APP_NAME} -f"
echo "   재시작:     systemctl restart ${APP_NAME}"
echo "   중지:       systemctl stop ${APP_NAME}"
echo ""
echo " ⚠ 첫 로그인 후 반드시 비밀번호를 변경하세요!"
echo "=========================================="

#!/usr/bin/env bash
# ============================================================
# asset-inventory 오프라인 설치 (Rocky Linux 8.10, x86_64)
#   구성: nginx(443 TLS 종단, 정식 인증서) → 내부 Next standalone(127.0.0.1:3100, HTTP)
#   도메인: itam.example.go.kr (내부 DNS → 서버IP). share.example.go.kr 와 같은 nginx 공존 가능
#          (server_name 분리 + itam 은 3100 포트 → share 3000 과 충돌 없음).
#
#   sudo bash setup-nginx.sh            ← 전체 설치 (앱 + nginx + 인증서 + systemd)
#   sudo bash setup-nginx.sh nginx      ← nginx/인증서만 재구성 (앱 재설치 없음, 인증서 교체 시)
#
#   비대화형: sudo SERVER_IP=10.0.0.5 PUBLIC_FQDN=itam.example.go.kr bash setup-nginx.sh
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BUNDLE_ROOT="$(cd "${HERE}/../.." && pwd)"      # 추출된 asset-inventory/ (scripts/deploy 두 단계 위)
APP_DIR="${ASSET_APP_DIR:-/opt/asset-inventory}"
NODE_DIR="${APP_DIR}/node"
APP_NAME="asset-inventory"
APP_USER="asset"
NEXT_PORT="${NEXT_INTERNAL_PORT:-3100}"   # share(공존시스템)가 3000 을 쓰므로 itam 은 3100 기본(같은 서버 공존)
LOCK_DIR="/var/lib/${APP_NAME}"
PUBLIC_FQDN="${PUBLIC_FQDN:-itam.example.go.kr}"

[[ $(id -u) -eq 0 ]] || { echo "root 필요: sudo bash setup-nginx.sh"; exit 1; }

read_env() { sed -n "s/^$1=//p" "$APP_DIR/.env" 2>/dev/null | head -n1; }

# ── 공존시스템(share) 정식 인증서 공유 ──
#   itam 은 자체 인증서를 만들지 않는다. 공존시스템 가 이미 배치한 *.example.go.kr 정식
#   인증서(기본 /etc/ssl/certs/shared.crt + /etc/ssl/private/shared.key)를 그대로
#   ssl_certificate 로 참조한다. 갱신은 공존시스템 한 곳에서만 → itam 은 nginx reload 로 반영.
#   경로가 다르면 SSL_CRT / SSL_KEY 환경변수로 지정.
SSL_CRT="${SSL_CRT:-/etc/ssl/certs/shared.crt}"
SSL_KEY="${SSL_KEY:-/etc/ssl/private/shared.key}"

# ── nginx 구성 ──
setup_nginx() {
  local IP="$1"
  echo "== nginx 외부 HTTPS 설정 — IP=$IP  FQDN=$PUBLIC_FQDN =="

  # 1) nginx 오프라인 설치 (번들 RPM — 의존 RPM 전체를 함께 설치: nginx-filesystem 등 noarch 포함)
  if ! command -v nginx >/dev/null 2>&1; then
    local RPMS=("$BUNDLE_ROOT"/rpms/*.rpm)
    if [ -e "${RPMS[0]}" ]; then
      dnf install -y --disablerepo='*' --nogpgcheck "${RPMS[@]}" 2>/dev/null \
        || rpm -Uvh --replacepkgs "${RPMS[@]}" 2>/dev/null \
        || rpm -Uvh --nodeps "${RPMS[@]}"
    else
      echo "  [nginx][오류] 번들 RPM 없음($BUNDLE_ROOT/rpms) — 빌드시 vendor/rpms 동봉 확인"; return 1
    fi
  fi
  command -v nginx >/dev/null 2>&1 || { echo "  [nginx][오류] 설치 실패"; return 1; }

  # 2) 인증서: 공존시스템 공유 인증서 확인 (자체 생성 안 함)
  if [ ! -s "$SSL_CRT" ] || [ ! -s "$SSL_KEY" ]; then
    echo "  [인증서][오류] 공존시스템 인증서를 찾을 수 없음:"
    echo "    crt=$SSL_CRT  key=$SSL_KEY"
    echo "    → share(공존시스템)가 먼저 설치돼 있어야 합니다(정식 인증서 공유)."
    echo "    → 경로가 다르면: sudo SSL_CRT=/경로/foo.crt SSL_KEY=/경로/foo.key bash setup-nginx.sh nginx"
    return 1
  fi
  # 와일드카드/도메인 커버 확인 (경고만 — 커버 안 해도 설치는 진행)
  if ! openssl x509 -in "$SSL_CRT" -noout -checkhost "$PUBLIC_FQDN" >/dev/null 2>&1; then
    echo "  [인증서][경고] $SSL_CRT 가 $PUBLIC_FQDN 를 커버하지 않을 수 있음(브라우저 경고 가능)."
  fi
  echo "  [인증서] 공존시스템 공유: $SSL_CRT (subject=$(openssl x509 -in "$SSL_CRT" -noout -subject 2>/dev/null | sed 's/subject=//'))"
  echo "  [인증서] 만료: $(openssl x509 -in "$SSL_CRT" -noout -enddate 2>/dev/null | sed 's/notAfter=//')"

  # 3) nginx 사이트 설정 배치 (+ upstream 포트 & http2 구문 치환)
  #    server_name 이 itam.example.go.kr 로 명시돼 SNI 로 매칭되므로, share 등 기존
  #    default_server 를 건드리지 않는다(공존 안전). 접속 도메인은 반드시
  #    itam.example.go.kr 로 들어와야 이 블록이 선택된다(IP 직접 접속은 default 서버로 감).
  #    http2 구문은 nginx 버전별로 갈린다:
  #      - 1.25.1+ : 'listen 443 ssl;' + 'http2 on;'  (listen...http2 는 deprecated 경고)
  #      - 1.25 미만: 'listen 443 ssl http2;'          (http2 on; 은 미지원)
  local NGXVER H2
  NGXVER="$(nginx -v 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  if [ -n "$NGXVER" ] && printf '%s\n1.25.1\n' "$NGXVER" | sort -V -C; then
    # NGXVER <= 1.25.0 → 구식 구문 (listen 라인에 http2)
    H2=""
    sed -e "s|__ITAM_PORT__|${NEXT_PORT}|g" \
        -e "s|__SSL_CRT__|${SSL_CRT}|g" \
        -e "s|__SSL_KEY__|${SSL_KEY}|g" \
        -e "s|    listen 443 ssl;|    listen 443 ssl http2;|" \
        -e "/^__HTTP2__$/d" "$HERE/nginx-itam.conf" > /etc/nginx/conf.d/itam.conf
  else
    # NGXVER >= 1.25.1 (또는 감지 실패 시 최신 가정) → http2 on;
    sed -e "s|__ITAM_PORT__|${NEXT_PORT}|g" \
        -e "s|__SSL_CRT__|${SSL_CRT}|g" \
        -e "s|__SSL_KEY__|${SSL_KEY}|g" \
        -e "s|^__HTTP2__$|    http2 on;|" "$HERE/nginx-itam.conf" > /etc/nginx/conf.d/itam.conf
  fi
  echo "  [nginx] conf.d/itam.conf 배치 (nginx ${NGXVER:-?}, server_name=${PUBLIC_FQDN}, upstream 127.0.0.1:${NEXT_PORT})"

  # 4) SELinux (enforcing 대응)
  if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" != "Disabled" ]; then
    setsebool -P httpd_can_network_connect 1 || echo "  [경고] setsebool 실패 — 502 시 수동 설정"
    restorecon -Rv /usr/sbin/nginx /etc/nginx /etc/ssl >/dev/null 2>&1 || true
    chcon -t cert_t "$SSL_CRT" "$SSL_KEY" 2>/dev/null || true   # 공존시스템 공유 인증서 (이미 라벨됐을 수 있음)
  fi

  # 5) 방화벽 443/80
  if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-service=https >/dev/null 2>&1 || true
    firewall-cmd --permanent --add-service=http  >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
    echo "  방화벽: 443/80 개방"
  fi

  # 6) 기동 (스테일 pid/실패 정리 → 실패 시 라벨 재보정 1회 재시도)
  nginx -t
  rm -f /run/nginx.pid 2>/dev/null || true
  systemctl reset-failed nginx 2>/dev/null || true
  systemctl enable nginx >/dev/null 2>&1 || true
  if ! systemctl restart nginx; then
    restorecon -v /usr/sbin/nginx /run/nginx.pid >/dev/null 2>&1 || true
    rm -f /run/nginx.pid 2>/dev/null || true; systemctl reset-failed nginx 2>/dev/null || true
    systemctl restart nginx
  fi
  # 공존 모드: IP 직접 접속은 default_server(share 등)로 갈 수 있으므로 SNI(도메인)로 확인.
  local code; code=$(curl -sk --resolve "${PUBLIC_FQDN}:443:${IP}" -o /dev/null -w '%{http_code}' "https://${PUBLIC_FQDN}/login" || echo "000")
  echo "  -> https://${PUBLIC_FQDN}/login (SNI→${IP}) → ${code} (200/302/307 기대)"
}

detect_ip() { hostname -I 2>/dev/null | awk '{print $1}'; }

# ── 서브커맨드: nginx만 (인증서 교체/외부접속 재구성) ──
if [ "${1:-}" = "nginx" ]; then
  [ -f "$APP_DIR/.env" ] || { echo "먼저 전체 설치: sudo bash setup-nginx.sh"; exit 1; }
  IP="${SERVER_IP:-$(detect_ip)}"
  [ -n "$IP" ] || { echo "[오류] IP 자동감지 실패 — SERVER_IP 지정 후 재실행"; exit 1; }
  setup_nginx "$IP"
  exit 0
fi

echo "== ${APP_NAME} 오프라인 설치 (nginx + 내부 Next) =="

# ── 1. 앱 + 번들 Node 배치 ──
mkdir -p "$APP_DIR" "$LOCK_DIR"
[[ "$BUNDLE_ROOT" != "$APP_DIR" ]] && cp -a "${BUNDLE_ROOT}/." "$APP_DIR/"
if [[ ! -x "${NODE_DIR}/bin/node" ]]; then
  NODE_TAR="${BUNDLE_ROOT}/node-linux-x64.tar.xz"; [[ -f "$NODE_TAR" ]] || NODE_TAR="${APP_DIR}/node-linux-x64.tar.xz"
  [[ -f "$NODE_TAR" ]] || { echo "[ERROR] 번들 Node 없음"; exit 1; }
  mkdir -p "$NODE_DIR"; tar -xf "$NODE_TAR" -C "$NODE_DIR" --strip-components=1
fi
NODE="${NODE_DIR}/bin/node"
echo "[OK] Node $($NODE -v)"
NODE_MAJOR=$("$NODE" -e "console.log(process.versions.node.split('.')[0])")
NODE_MINOR=$("$NODE" -e "console.log(process.versions.node.split('.')[1])")
if (( NODE_MAJOR < 22 || (NODE_MAJOR == 22 && NODE_MINOR < 6) )); then
  echo "[ERROR] 번들 Node $($NODE -v) < 22.6 — .ts 실행(--experimental-strip-types) 미지원"; exit 1
fi

# ── 2. 서비스 계정 ──
id "$APP_USER" &>/dev/null || useradd -r -s /sbin/nologin "$APP_USER"

# ── 3. better-sqlite3 native smoke (실패 시 Plan B 소스 리빌드) ──
STANDALONE_BS="${APP_DIR}/.next/standalone/node_modules/better-sqlite3"
[[ -d "$STANDALONE_BS" ]] || STANDALONE_BS="${APP_DIR}/node_modules/better-sqlite3"
if ! "$NODE" -e "require('${STANDALONE_BS}'); console.log('native ok')"; then
  echo "[WARN] better-sqlite3 native 로드 실패 — Plan B(소스 리빌드) 시도"
  bash "${APP_DIR}/scripts/deploy/native-planb.sh" || { echo "[ERROR] Plan B 실패. gcc/make/python3 설치 후 재시도."; exit 1; }
  "$NODE" -e "require('${STANDALONE_BS}'); console.log('native ok(planb)')" || { echo "[ERROR] Plan B 후에도 native 로드 실패"; exit 1; }
fi
echo "[OK] better-sqlite3 native smoke 통과"

# ── 4. .env (AUTH_SECRET 강제, COOKIE_SECURE=true, PUBLIC_FQDN 고정, 내부 HTTP 3000) ──
if [[ ! -f "${APP_DIR}/.env" ]]; then
  SECRET=$("$NODE" -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
  cat > "${APP_DIR}/.env" <<ENVEOF
NEXT_TELEMETRY_DISABLED=1
NODE_ENV=production
AUTH_SECRET=${SECRET}
COOKIE_SECURE=true
PORT=${NEXT_PORT}
HOSTNAME=127.0.0.1
PUBLIC_FQDN=${PUBLIC_FQDN}
ASSET_DB_CWD=${APP_DIR}
ASSET_DB_PATH=${APP_DIR}/data.db
ASSET_LOCK_PATH=${LOCK_DIR}/maintenance.lock
TRUST_PROXY=true
# 타임존 고정 — 감사/접속 로그를 서버 OS 무관하게 KST로 기록
TZ=Asia/Seoul
ENVEOF
  echo "[OK] .env 생성 (COOKIE_SECURE=true, 내부 127.0.0.1:${NEXT_PORT})"
fi

# ── 4-0. DB 최소 초기화 (스키마 + 관리자 계정 + 메뉴권한, 데모 데이터 없음) ──
#   반입한 data.db 가 없거나 users 테이블이 비면 로그인이 "사용자 없음"으로 막힌다.
#   SEED_MINIMAL=1 로 스키마+계정(admin/user/viewer)+권한만 생성한다.
#   기존 data.db 가 있고 users 가 있으면 절대 건드리지 않는다(운영 데이터 보호).
DB_FILE="${APP_DIR}/data.db"
BS_MOD="${APP_DIR}/.next/standalone/node_modules/better-sqlite3"
[[ -d "$BS_MOD" ]] || BS_MOD="${APP_DIR}/node_modules/better-sqlite3"
NEED_INIT=1
if [[ -f "$DB_FILE" ]]; then
  USERCNT=$("$NODE" -e "try{const d=require('${BS_MOD}')('${DB_FILE}');console.log(d.prepare('SELECT COUNT(*) c FROM users').get().c)}catch(e){console.log(0)}" 2>/dev/null || echo 0)
  [[ "${USERCNT:-0}" -gt 0 ]] && { NEED_INIT=0; echo "[OK] 기존 DB 사용자 ${USERCNT}명 — DB 초기화 건너뜀"; }
fi
if [[ "$NEED_INIT" == "1" ]]; then
  echo "[..] 빈 DB 감지 → 최소 초기화(스키마+계정+권한)"
  # ESM bare import('better-sqlite3')는 스크립트 파일 위치 기준으로 node_modules 를
  # 해석한다. standalone 만 better-sqlite3+bindings 가 완비돼 있으므로, 시드 스크립트를
  # standalone 안으로 복사해 실행한다(루트 node_modules 는 bindings 누락으로 실패).
  SA="${APP_DIR}/.next/standalone"
  if [[ -d "${SA}/node_modules/better-sqlite3/build" ]]; then
    cp -f "${APP_DIR}/scripts/db-seed.mjs" "${SA}/db-seed.mjs"
    ( cd "$SA" && SEED_MINIMAL=1 ASSET_DB_PATH="$DB_FILE" "$NODE" db-seed.mjs ) \
      || { rm -f "${SA}/db-seed.mjs"; echo "[ERROR] DB 최소 초기화 실패 — scripts/db-seed.mjs 확인"; exit 1; }
    rm -f "${SA}/db-seed.mjs"
  else
    ( cd "$APP_DIR" && SEED_MINIMAL=1 ASSET_DB_PATH="$DB_FILE" "$NODE" scripts/db-seed.mjs ) \
      || { echo "[ERROR] DB 최소 초기화 실패(루트 경로) — better-sqlite3 확인"; exit 1; }
  fi
  echo "[OK] DB 초기화 완료 (admin@example.go.kr / admin123 · 첫 로그인 후 변경 필수)"
fi

chown -R "${APP_USER}:${APP_USER}" "$APP_DIR" "$LOCK_DIR"
chmod 600 "${APP_DIR}/.env"
[[ -f "${APP_DIR}/data.db" ]] && chmod 600 "${APP_DIR}/data.db" || true

# ── 4-1. SELinux 라벨 정규화 (필수) ──
#   앱을 빌드머신 홈(~/asset)에서 tar 하면 user_home_t 라벨이 딸려온다.
#   Enforcing 환경에서 systemd(init_t)는 user_home_t 인 EnvironmentFile(.env)을
#   읽지 못해 'Failed to load environment files: Permission denied' → 기동 실패.
#   restorecon -R 로 /opt 기본 라벨(usr_t 등)로 정규화하면 해결된다.
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" != "Disabled" ]; then
  restorecon -R "$APP_DIR" >/dev/null 2>&1 || true
  # 그래도 .env 로드가 막히면 명시적으로 etc_t 지정
  chcon -t etc_t "${APP_DIR}/.env" 2>/dev/null || true
fi

# ── 5. systemd: 내부 Next standalone (HTTP 127.0.0.1:3000) ──
cat > /etc/systemd/system/${APP_NAME}.service <<SVCEOF
[Unit]
Description=정보시스템 자산관리 (내부 Next, nginx 프록시 뒤)
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=${NODE} ${APP_DIR}/.next/standalone/server.js
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

# ── 6. 보존/백업 타이머 ──
for unit in asset-retention.service asset-retention.timer asset-backup.service asset-backup.timer; do
  [[ -f "${APP_DIR}/scripts/deploy/${unit}" ]] && cp "${APP_DIR}/scripts/deploy/${unit}" /etc/systemd/system/${unit}
done

systemctl daemon-reload
systemctl enable --now ${APP_NAME}
systemctl enable --now asset-retention.timer 2>/dev/null || true
systemctl enable --now asset-backup.timer 2>/dev/null || true
sleep 3
LCODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${NEXT_PORT}/login" || echo "000")
echo "  내부 앱: $(systemctl is-active ${APP_NAME})  http://127.0.0.1:${NEXT_PORT}/login → ${LCODE} (200 기대)"

# ── 7. nginx 외부 HTTPS ──
IP="${SERVER_IP:-$(detect_ip)}"
[ -n "$IP" ] || { echo "[오류] IP 자동감지 실패 — SERVER_IP 지정 후 'setup-nginx.sh nginx' 재실행"; exit 1; }
setup_nginx "$IP"

echo "════════════════════════════════════════════════════════════"
echo " 설치 완료 — 외부 접속 가능"
echo "  접속 주소   : https://${PUBLIC_FQDN}/  (내부 DNS 등록 필수 — share 와 공존 시 IP 직접접속은 itam 이 아님)"
echo "  초기 계정   : admin@example.go.kr / admin123  (첫 로그인 후 변경 필수)"
echo "  서비스 상태 : systemctl status ${APP_NAME} nginx"
echo "  인증서      : 공존시스템 공유(${SSL_CRT}) — 갱신은 공존시스템 한 곳만, itam 은 자동 반영. 경로 변경 시: sudo SSL_CRT=... SSL_KEY=... bash ${APP_DIR}/scripts/deploy/setup-nginx.sh nginx"
echo "  운영/장애   : ${APP_DIR}/docs/관리자매뉴얼.md   ·   사용자: ${APP_DIR}/docs/사용자매뉴얼.md"
echo "════════════════════════════════════════════════════════════"

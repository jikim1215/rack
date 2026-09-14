#!/usr/bin/env bash
# ============================================================
# 폐쇄망 반입 후 실행하는 단일 진입점 — 신규설치/업그레이드를 자동 판별한다.
#
#   sudo bash deploy.sh              ← 이 한 줄이면 끝
#   sudo bash deploy.sh --check      ← 아무것도 바꾸지 않고 현재 상태·수행 예정 작업만 출력
#   sudo bash deploy.sh --force-install   ← 기존 설치가 있어도 신규설치 경로(setup-nginx.sh) 강제
#
# 판별 기준: /opt/asset-inventory/data.db + .env 가 있으면 업그레이드, 없으면 신규설치.
#   - 업그레이드: upgrade-inplace.sh  (data.db/.env/node/tls/backups 보존, 롤백본 생성)
#   - 신규설치  : setup-nginx.sh      (앱 + nginx + 인증서 + systemd)
#
# 비대화형 옵션(신규설치 시): PUBLIC_FQDN, SERVER_IP, SSL_CRT, SSL_KEY, NEXT_INTERNAL_PORT
#   예) sudo PUBLIC_FQDN=itam.example.go.kr bash deploy.sh
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BUNDLE_ROOT="$(cd "${HERE}/../.." && pwd)"   # 추출된 asset-inventory/
APP_DIR="${ASSET_APP_DIR:-/opt/asset-inventory}"
MODE=""
CHECK_ONLY=0
for a in "$@"; do
  case "$a" in
    --check) CHECK_ONLY=1 ;;
    --force-install) MODE="install" ;;
    *) echo "[ERROR] 알 수 없는 옵션: $a"; exit 1 ;;
  esac
done

say() { printf '%s\n' "$*"; }
hr()  { printf '%s\n' "------------------------------------------------------------"; }

[[ $(id -u) -eq 0 ]] || { say "[ERROR] root 권한 필요:  sudo bash $(basename "$0")"; exit 1; }

# ── 0. 번들 무결성 ──
hr; say " 정보시스템 자산관리 — 폐쇄망 배포"; hr
for f in .next/standalone/server.js scripts/deploy/setup-nginx.sh scripts/deploy/upgrade-inplace.sh node-linux-x64.tar.xz; do
  [[ -e "${BUNDLE_ROOT}/${f}" ]] || { say "[ERROR] 번들 구성 누락: ${f} — 반입 파일이 손상됐습니다(SHA256 재확인)"; exit 1; }
done
say " 번들   : ${BUNDLE_ROOT}"
say " 대상   : ${APP_DIR}"

# ── 1. 모드 판별 ──
if [[ -z "$MODE" ]]; then
  if [[ -f "${APP_DIR}/data.db" && -f "${APP_DIR}/.env" ]]; then MODE="upgrade"; else MODE="install"; fi
fi

if [[ "$MODE" == "upgrade" ]]; then
  CUR_PORT="$(sed -n 's/^PORT=//p' "${APP_DIR}/.env" 2>/dev/null | head -1)"
  CUR_FQDN="$(sed -n 's/^PUBLIC_FQDN=//p' "${APP_DIR}/.env" 2>/dev/null | head -1)"
  say " 모드   : 업그레이드 (기존 설치 발견 — 데이터 보존)"
  say "          내부포트 ${CUR_PORT:-?} · 도메인 ${CUR_FQDN:-?}"
  say "          DB $(du -h "${APP_DIR}/data.db" 2>/dev/null | cut -f1)"
else
  say " 모드   : 신규설치 (기존 data.db 없음)"
  say "          도메인 ${PUBLIC_FQDN:-itam.example.go.kr} · 내부포트 ${NEXT_INTERNAL_PORT:-3100}"
fi
hr

# ── 2. --check: 상태만 출력하고 종료 ──
if [[ "$CHECK_ONLY" == "1" ]]; then
  say " [점검 모드] 아무것도 변경하지 않았습니다."
  if [[ "$MODE" == "upgrade" ]]; then
    say " 수행 예정:"
    say "   1) data.db 백업 → ${APP_DIR}/backups/"
    say "   2) 앱 트리 교체(.next/src/scripts/docs/node_modules) — data.db·.env·node·tls·backups 보존"
    say "   3) 서비스 재시작 + 스모크(로그인 화면·CSP·마이그레이션 결과)"
    say "   * 첫 요청 시 스키마 마이그레이션 자동 실행(메뉴권한 시드·감사로그 확장·날짜 정규화)"
    if [[ -f "${HERE}/preflight-perms.cjs" && -x "${APP_DIR}/node/bin/node" ]]; then
      say ""; say " 현재 메뉴 권한이 실제로 막게 될 범위:"
      # data.db(600, asset 소유)를 읽어야 해서 asset 으로 실행한다. 그런데 번들을 푼 위치가
      # 운영자 홈(예: /home/<id>, mode 700)이면 asset 이 번들 경로를 탐색할 수 없어
      # MODULE_NOT_FOUND 로 죽는다 → 스크립트를 /tmp 에 복사해 asset 이 읽을 수 있게 한 뒤 실행.
      PF_TMP="$(mktemp -d /tmp/asset-preflight-XXXXXX)"
      install -m 644 "${HERE}/preflight-perms.cjs" "${PF_TMP}/preflight-perms.cjs"
      chmod 755 "$PF_TMP"
      # 권한 문제로 읽기 실패하면 조용히 비지 않고 사유를 남긴다.
      sudo -u asset "${APP_DIR}/node/bin/node" "${PF_TMP}/preflight-perms.cjs" "$APP_DIR" 2>&1 | sed 's/^/   /' \
        || say "   (권한 리포트 생성 실패 — 배포 자체에는 영향 없음)"
      rm -rf "$PF_TMP"
    fi
  else
    say " 수행 예정: nginx 설치(번들 RPM) + 앱 배치 + systemd 등록 + 최소 DB 초기화"
    say " 필요 조건: 공유 인증서(${SSL_CRT:-/etc/ssl/certs/shared.crt}) 존재, 내부 DNS 에 도메인 등록"
  fi
  hr; exit 0
fi

# ── 3. 실행 ──
if [[ "$MODE" == "upgrade" ]]; then
  bash "${HERE}/upgrade-inplace.sh" "__BUNDLE_TREE__:${BUNDLE_ROOT}"
else
  bash "${HERE}/setup-nginx.sh"
fi

# shellcheck shell=bash
# ============================================================
# 번들 nginx 고정판 — 한 곳에서만 정한다.
#   빌드: oneshot-build.sh · .github/workflows/release.yml (내려받기) · build-release.sh (검증·동봉)
#   서버: nginx-upgrade.sh (설치·교체) · nginx-harden.sh (취약 판 경고)
#
# 출처는 nginx.org 공식 el8 저장소. Rocky 8 AppStream 의 nginx 모듈 스트림(1.14~1.24)은
#   2026-11 F5 권고(CVE-2026-123007 HTTP/2 원격 코드 실행 · 118899 TLS1.3 무한루프 · 113425 mail ·
#   123634 resolver 등)의 해결판이 없다 → 해결판(안정 1.30.7+)을 nginx.org 에서 받는다.
# 판을 올릴 때: NGINX_PIN_VERSION 만 바꾼다. 서명키 파일이 바뀌었으면(nginx.org 공지 확인) SHA256 도 갱신.
# ============================================================
NGINX_PIN_VERSION=1.30.7
NGINX_PIN_RPM="nginx-${NGINX_PIN_VERSION}-1.el8.ngx.x86_64.rpm"
NGINX_PIN_URL="https://nginx.org/packages/centos/8/x86_64/RPMS/${NGINX_PIN_RPM}"
NGINX_KEY_FILE=nginx_signing.key
NGINX_KEY_URL="https://nginx.org/keys/${NGINX_KEY_FILE}"
NGINX_KEY_SHA256=55385da31d198fa6a5012d40ae98ecb272a6c4e8fffffba94719ffd3e87de37a   # 2026-11-23 확인 (key ID b49f6b46)

# 패치 하한 — 2026-11 F5 권고 해결판: 안정 1.30.7+ · 메인라인 1.31.9+ (1.32 이상은 해결판 이후)
nginx_ver_lt() { [[ "$1" != "$2" && "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" == "$1" ]]; }
nginx_vulnerable() { # $1=버전(예 1.30.3) → 0(참)=취약
  local v="$1"
  if nginx_ver_lt "$v" 1.30.7; then return 0; fi
  if ! nginx_ver_lt "$v" 1.31.0 && nginx_ver_lt "$v" 1.31.9; then return 0; fi
  return 1
}

# RPM 서명 검증 — 시스템 rpm 키링을 건드리지 않도록 임시 rpmdb 에 고정 키만 넣고 확인한다.
#   $1=rpm 파일 $2=서명키 파일. 키 파일 SHA256 이 고정값과 다르면 실패.
nginx_verify_rpm() {
  local rpm_file="$1" key="$2" db rc=0
  [[ -f "$rpm_file" && -f "$key" ]] || { echo "nginx RPM/서명키 없음: $rpm_file $key" >&2; return 1; }
  [[ "$(sha256sum "$key" | awk '{print $1}')" == "$NGINX_KEY_SHA256" ]] \
    || { echo "nginx 서명키 SHA256 불일치: $key" >&2; return 1; }
  db="$(mktemp -d)"
  { rpm --dbpath "$db" --initdb && rpm --dbpath "$db" --import "$key" \
      && rpmkeys --dbpath "$db" --checksig "$rpm_file"; } >/dev/null 2>&1 || rc=1
  rm -rf "$db"
  [[ "$rc" == 0 ]] || echo "nginx RPM 서명 검증 실패: $rpm_file" >&2
  return "$rc"
}

# 빌드용: 고정판 RPM + 서명키를 $1 디렉터리에 받고 검증한다 (인터넷 필요)
nginx_fetch_pinned() {
  local dest="$1"
  mkdir -p "$dest"
  curl -fsSL "$NGINX_KEY_URL" -o "$dest/$NGINX_KEY_FILE"
  curl -fsSL "$NGINX_PIN_URL" -o "$dest/$NGINX_PIN_RPM"
  nginx_verify_rpm "$dest/$NGINX_PIN_RPM" "$dest/$NGINX_KEY_FILE"
}

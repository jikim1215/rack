#!/usr/bin/env bash
# ============================================================
# nginx 수정판 교체 — 2026-11 F5 권고(KISA 보호나라 「NGINX 제품 보안 업데이트 권고」 2026-11-19)
#   CVE-2026-123007(HTTP/2 원격 코드 실행) · 123633 · 121810 · 123634(resolver) · 113425(mail) ·
#   118899(TLS 1.3 요청 본문 무한루프) 외 — 해결판: 안정 1.30.7+ / 메인라인 1.31.9+
#
#   설치된 nginx 가 취약 판이면 번들의 nginx.org 고정판 RPM(nginx-pin.sh)으로 교체한다.
#   nginx 는 공존시스템(share 등)과 함께 쓰는 프로세스다 — 설정 파일은 하나도 고치지 않고 바이너리 패키지만 바꾼다
#   (rpm 이 바꾼 기본 설정은 교체 직후 /etc/nginx 백업으로 되돌린다 — 교체 전후 /etc/nginx 동일).
#
#   교체 전에 새 바이너리로 현재 설정을 검사(nginx -t)해 통과할 때만 진행한다 — 시스템 변경 없이 사전 검증.
#   자동으로 못 하는 경우(조치 필요, 종료코드 2 — 아무것도 바꾸지 않음):
#     · nginx.org 동적 모듈(nginx-module-njs 등) 설치 — 같은 판 모듈 RPM 이 함께 필요(번들에 없음)
#     · AppStream 동적 모듈 기능(mail{} · stream{} · perl · xslt · image_filter)을 설정이 사용
#     · rpm 패키지가 아닌 nginx(소스 빌드 등)
#   AppStream nginx(1.14 등)의 nginx-mod-* 는 새 판과 ABI 가 달라 그대로 두면 nginx 가 뜨지 않는다 —
#   설정이 그 기능을 안 쓸 때(위 검사 통과)만 함께 제거한다.
#
# 사용: sudo bash nginx-upgrade.sh            # 교체 (사전 검증 → 백업 → rpm 교체 → nginx -t → restart)
#       sudo bash nginx-upgrade.sh --check    # 아무것도 바꾸지 않고 판정·사전 검증만
# 종료코드: 0 해결판(교체 완료·이미 해결판·nginx 없음) · 1 오류 · 2 조치 필요(--check 에선 교체 대상 포함)
# ============================================================
set -euo pipefail
MODE="${1:-apply}"
case "$MODE" in apply|--check) ;; *) echo "[ERROR] 알 수 없는 옵션: $MODE (--check 만 지원)"; exit 1 ;; esac
[[ $(id -u) -eq 0 ]] || { echo "[ERROR] root 필요: sudo bash $0 [--check]"; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
BUNDLE_ROOT="$(cd "${HERE}/../.." && pwd)"
# shellcheck source=nginx-pin.sh
source "${HERE}/nginx-pin.sh"
RPM_FILE="${BUNDLE_ROOT}/rpms/${NGINX_PIN_RPM}"
KEY_FILE="${BUNDLE_ROOT}/rpms/${NGINX_KEY_FILE}"
TS=$(date +%Y%m%d_%H%M%S)
say()  { echo "   $*"; }
need() { echo "   [조치 필요] $*"; }

echo "== nginx 수정판 교체 ($([[ "$MODE" == --check ]] && echo '점검만' || echo '적용')) — 기준 ${NGINX_PIN_VERSION} =="
if ! command -v nginx >/dev/null 2>&1; then
  say "nginx 미설치 — setup-nginx.sh 가 번들 nginx ${NGINX_PIN_VERSION} 을 설치한다"; exit 0
fi
NGX_BIN="$(command -v nginx)"
CUR="$(nginx -v 2>&1 | sed -n 's#^nginx version: nginx/##p')"
PKG="$(rpm -qf "$NGX_BIN" 2>/dev/null || true)"
say "현재: nginx ${CUR:-?} (${PKG:-rpm 패키지 아님})"
[[ -n "$CUR" ]] || { echo "[ERROR] nginx 버전을 읽지 못함"; exit 1; }
if ! nginx_vulnerable "$CUR"; then
  say "해결판 — 교체 불필요"; exit 0
fi
say "취약 판 — 2026-11 F5 권고 영향 범위 (해결판: 1.30.7+ / 1.31.9+)"
if [[ -z "$PKG" || "$(rpm -q --qf '%{NAME}' "$PKG" 2>/dev/null)" != nginx ]]; then
  need "rpm 'nginx' 패키지가 아닌 nginx(${NGX_BIN}) — 자동 교체 불가. 설치 주체가 ${NGINX_PIN_VERSION}+ 로 교체"; exit 2
fi
nginx_verify_rpm "$RPM_FILE" "$KEY_FILE" || { echo "[ERROR] 번들 nginx RPM 검증 실패 — 번들 손상 여부(SHA256SUMS) 확인"; exit 1; }

DUMP="$(nginx -T 2>&1)" || { sed 's/^/      /' <<<"$DUMP" | tail -n 5; echo "[ERROR] 현재 설정이 이미 깨져 있다(nginx -t 실패) — 먼저 고칠 것"; exit 1; }
ACTIVE="$(grep -vE '^[[:space:]]*#' <<<"$DUMP")"

# 버전 종속 동적 모듈
mapfile -t ORG_MODS < <(rpm -qa 'nginx-module-*' --qf '%{NAME}\n' | sort)
mapfile -t AS_MODS < <(rpm -qa 'nginx-mod-*' 'nginx-all-modules' --qf '%{NAME}\n' | sort)
if [[ ${#ORG_MODS[@]} -gt 0 ]]; then
  need "nginx.org 동적 모듈 설치됨: ${ORG_MODS[*]} — ${NGINX_PIN_VERSION} 용 같은 모듈 RPM 을 함께 받아 'rpm -Uvh' 로 동시 교체할 것"; exit 2
fi
if [[ ${#AS_MODS[@]} -gt 0 ]]; then
  USES="$(grep -nE '(^|[;{}])[[:space:]]*((mail|stream)[[:space:]]*[{]|(perl_modules|perl_require|perl_set|perl|xslt_stylesheet|xslt_types|image_filter[a-z_]*)[[:space:]])' <<<"$ACTIVE" || true)"
  if [[ -n "$USES" ]]; then
    need "AppStream 동적 모듈(${AS_MODS[*]}) 기능을 설정이 사용 — 새 판에 같은 모듈이 없어 자동 교체 불가:"
    sed 's/^/      /' <<<"$USES"
    say "  → 해당 기능 담당과 협의: nginx.org 모듈 RPM(nginx-module-perl/xslt/image-filter, ${NGINX_PIN_VERSION}) 을 함께 반입하거나 기능 정리"
    exit 2
  fi
fi

# 사전 검증 — 새 바이너리(설치 전)로 현재 설정 검사. 설정 사본에서 제거 예정 AppStream 모듈 적재만 뺀다.
#   nginx.org 빌드의 임시 경로(/var/cache/nginx/*_temp)는 nginx -t 가 만든다 — 없던 디렉터리는 검사 뒤 지운다(교체 시 rpm 이 만듦).
CACHE_MADE=0; [[ -e /var/cache/nginx ]] || CACHE_MADE=1
WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; [[ "$CACHE_MADE" == 1 && "$(rpm -qf /var/cache/nginx 2>/dev/null)" != nginx-* ]] && rm -rf /var/cache/nginx; return 0; }
trap cleanup EXIT
mkdir -p /var/cache/nginx
( cd "$WORK" && rpm2cpio "$RPM_FILE" | cpio -idm --quiet ./usr/sbin/nginx )
cp -a /etc/nginx "$WORK/etc"
if [[ ${#AS_MODS[@]} -gt 0 ]]; then
  sed -i -E '/^[[:space:]]*include[[:space:]]+\/usr\/share\/nginx\/modules\//d; /^[[:space:]]*load_module[[:space:]]+.*\/usr\/lib64\/nginx\/modules\//d' "$WORK/etc/nginx.conf"
fi
if ! PRE="$("$WORK/usr/sbin/nginx" -t -p /etc/nginx/ -c "$WORK/etc/nginx.conf" 2>&1)"; then
  sed 's/^/      /' <<<"$PRE"
  echo "[ERROR] 새 nginx ${NGINX_PIN_VERSION} 로 현재 설정 검사 실패 — 아무것도 바꾸지 않음. 위 오류의 지시어를 정리한 뒤 재실행"
  exit 1
fi
say "사전 검증: nginx ${NGINX_PIN_VERSION} 로 현재 설정 검사 통과"

if [[ "$MODE" == --check ]]; then
  [[ ${#AS_MODS[@]} -gt 0 ]] && say "교체 시 함께 제거: ${AS_MODS[*]} (설정 미사용 확인됨)"
  need "nginx ${CUR} → ${NGINX_PIN_VERSION} 교체 필요: sudo bash ${HERE}/nginx-upgrade.sh"
  exit 2
fi

# 교체
BK="/etc/nginx.bak-nginxupgrade-${TS}"
cp -a /etc/nginx "$BK"
rpm -qa 'nginx*' | sort > "${BK}.packages.txt"
say "설정 백업: ${BK} (설치 패키지 목록 ${BK}.packages.txt)"
if [[ ${#AS_MODS[@]} -gt 0 ]]; then
  # AppStream nginx 본체가 nginx-all-modules 를 요구한다 — 본체는 바로 아래에서 교체되므로 그 의존만 무시한다(--nodeps)
  rpm -e --nodeps "${AS_MODS[@]}" || { echo "[ERROR] AppStream 동적 모듈 제거 실패 — 변경 없음. 설정 백업: ${BK}"; exit 1; }
  say "AppStream 동적 모듈 제거: ${AS_MODS[*]}"
fi
# 서명은 위 nginx_verify_rpm 에서 고정 키로 확인했다 — 시스템 rpm 키링은 건드리지 않는다
if ! rpm -Uvh --nosignature "$RPM_FILE"; then
  echo "[ERROR] rpm 교체 실패 — nginx ${CUR} 그대로$([[ ${#AS_MODS[@]} -gt 0 ]] && echo ' (AppStream 동적 모듈은 제거됨 — 설정이 쓰지 않는 것을 확인함)'). 설정 백업: ${BK}"
  exit 1
fi
NEW="$(nginx -v 2>&1 | sed -n 's#^nginx version: nginx/##p')"
[[ "$NEW" == "$NGINX_PIN_VERSION" ]] || { echo "[ERROR] 교체 후 버전 ${NEW:-?} (기대 ${NGINX_PIN_VERSION})"; exit 1; }
# rpm 은 손대지 않은 기본 설정을 새 판 기본값으로 바꾸고(AppStream nginx.conf → nginx.org 판, conf.d/default.conf 추가 등)
# 수정된 파일은 .rpmnew 로 둔다 → /etc/nginx 를 교체 전 그대로 되돌려 서버 블록(공존시스템 포함)이 바뀌지 않게 한다.
#   사전 검증이 바로 이 설정을 새 바이너리로 통과시켰다. 새 판 기본 설정은 참고용으로 보관.
mv /etc/nginx "${BK}.new-defaults"
cp -a "$BK" /etc/nginx
say "설정 복원: /etc/nginx = 교체 전과 동일 (새 판 기본 설정: ${BK}.new-defaults)"
command -v restorecon >/dev/null 2>&1 && restorecon -R /usr/sbin/nginx /etc/nginx /var/cache/nginx /var/log/nginx >/dev/null 2>&1 || true
systemctl daemon-reload
if ! nginx -t; then
  echo "[ERROR] 교체 후 nginx -t 실패 — 설정 백업: ${BK}. 'journalctl -u nginx -n 50'"; exit 1
fi
rm -f /run/nginx.pid.oldbin 2>/dev/null || true
systemctl reset-failed nginx 2>/dev/null || true
if ! systemctl restart nginx; then
  echo "[ERROR] nginx 재시작 실패 — 'journalctl -u nginx -n 50' 확인. 설정 백업: ${BK}"; exit 1
fi
MPID="$(systemctl show -p MainPID --value nginx 2>/dev/null || echo 0)"
EXE="$(readlink "/proc/${MPID}/exe" 2>/dev/null || true)"
if [[ "$MPID" == 0 || "$EXE" == *deleted* || -z "$EXE" ]]; then
  echo "[ERROR] 실행 중인 nginx 가 새 바이너리가 아니다(pid ${MPID}, ${EXE:-?}) — 'sudo systemctl restart nginx'"; exit 1
fi
say "교체 완료: nginx ${CUR} → ${NEW} (pid ${MPID}) — /etc/nginx 변경 없음"
say "되돌리기는 구판 RPM 이 있어야 한다(번들에 없음). 문제 시 설정은 ${BK} 에서 복원"
exit 0

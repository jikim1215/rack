#!/usr/bin/env bash
# ============================================================
# nginx2root(2026-11) 임시 완화 — nginx 비인증 원격 코드 실행 5건 + Linux SCTP 권한 상승
#   근거: https://xint.io/blog/nginx2root-remote-code-execution · https://nginx2root.com
#   해결판은 nginx 1.30.7+ / 1.31.9+ — 번들은 v1.8.0 부터 nginx.org 1.30.7 을 싣고 nginx-upgrade.sh 가 취약 판을 교체한다.
#   이 스크립트는 교체 전까지 알려진 공격 경로를 설정으로 끊고, 설치된 nginx 가 취약 판이면 [조치 필요]로 알린다.
#   설정 완화는 패치의 대체재가 아니다(TLS 1.3 무한루프 CVE-2026-118899 등은 설정으로 못 막는다). 수정판 반입 후에도 둬도 무해하다.
#
#   CVE-2026-123007  HTTP/2                    itam.conf: listen 의 http2 제거 · 'http2 on;' → off   [자동]
#   CVE-2026-123633  HTTP/2 → upstream 전달     (위와 같음)                                          [자동]
#   CVE-2026-121810  HTTP/3(QUIC) → upstream    itam.conf: quic 리스너 주석 · 'http3 on;' → off ·
#                                               Alt-Svc → "clear"                                    [자동]
#   CVE-2026-123634  resolver + 요청별 목적지     탐지만 (고정 upstream 전환은 설정 소유자 판단)        [경고]
#   CVE-2026-113425  mail 프록시(auth_http)      탐지만 (루프백 바인딩·방화벽은 운영 판단)             [경고]
#   Linux SCTP       커널 권한 상승(컨테이너 탈출)  /etc/modprobe.d 에 'install sctp /bin/false'        [자동]
#
#   고치는 nginx 파일은 itam 소유 /etc/nginx/conf.d/itam.conf 하나뿐이다. 공존시스템(share) 설정은
#   수정 금지(관리자매뉴얼 §13) — nginx 가 실제로 읽는 나머지 파일(nginx -T 기준)은 점검만 하고 위치를 알린다.
#   nginx 1.25 미만은 HTTP/2 가 '주소:포트' 단위라, 같은 443 의 다른 server 블록 하나가 http2 면
#   itam 도 HTTP/2 로 응답한다 → 마지막 ALPN 점검이 h2 면 공존시스템 담당과 함께 조치해야 한다.
#
#   reload 로는 기존 HTTP/2 연결을 쥔 구 워커가 남는다 → 설정을 바꿨으면 restart.
#
# 사용: sudo bash nginx-harden.sh            # 적용 (백업 → nginx -t → restart → ALPN 확인, 실패 시 원복)
#       sudo bash nginx-harden.sh --check    # 아무것도 바꾸지 않고 점검만
# 종료코드: 0 완화됨 · 1 오류(바꾼 것은 원복) · 2 수동 조치 필요(--check 에선 적용할 변경 있음 포함)
# ============================================================
set -euo pipefail
MODE="${1:-apply}"
case "$MODE" in apply|--check) ;; *) echo "[ERROR] 알 수 없는 옵션: $MODE (--check 만 지원)"; exit 1 ;; esac
[[ $(id -u) -eq 0 ]] || { echo "[ERROR] root 필요: sudo bash $0 [--check]"; exit 1; }
command -v nginx >/dev/null 2>&1 || { echo "[ERROR] nginx 없음 — 점검 대상 아님"; exit 1; }

APP=/opt/asset-inventory
ITAM_CONF="${ITAM_NGINX_CONF:-/etc/nginx/conf.d/itam.conf}"
FQDN="${PUBLIC_FQDN:-$(sed -n 's/^PUBLIC_FQDN=//p' "$APP/.env" 2>/dev/null | head -n1)}"
TS=$(date +%Y%m%d_%H%M%S)
SCTP_CONF=/etc/modprobe.d/nginx2root-sctp.conf
ACTION=0   # 수동 조치가 필요한 항목 수
say()  { echo "   $*"; }
need() { echo "   [조치 필요] $*"; ACTION=$((ACTION + 1)); }

# itam.conf 에 적용할 치환 — 주석 줄은 건드리지 않는다
SED_FIX=(
  -e '/^[[:space:]]*listen[[:space:]]/ s/[[:space:]]+http2([[:space:];])/\1/g'
  -e 's/^([[:space:]]*)http2[[:space:]]+on[[:space:]]*;/\1http2 off;/'
  -e 's/^([[:space:]]*)(listen[[:space:]][^;#]*[[:space:]]quic([[:space:];]).*)$/\1# [nginx2root] \2/'
  -e 's/^([[:space:]]*)http3[[:space:]]+on[[:space:]]*;/\1http3 off;/'
  -e 's/^([[:space:]]*)add_header[[:space:]]+Alt-Svc[[:space:]].*$/\1add_header Alt-Svc "clear" always;/'
)
# 지시어 시작 위치 — 줄 처음 또는 한 줄짜리 블록('server { listen 443 ssl http2; ... }') 안
D='(^|[;{}])[[:space:]]*'
RE_H2="${D}(listen[[:space:]][^;#]*[[:space:]]http2([[:space:];]|\$)|http2[[:space:]]+on[[:space:]]*;)"
RE_H3="${D}(listen[[:space:]][^;#]*[[:space:]]quic([[:space:];]|\$)|http3[[:space:]]+on[[:space:]]*;)"

dump_conf() { nginx -T 2>&1; }
conf_files() { sed -n 's/^# configuration file \(.*\):$/\1/p' <<<"$1" | sort -u; }
# grep 결과를 '파일:줄번호: 내용' 으로 (실제 파일 기준)
scan() { # $1=정규식 $2..=파일
  local re="$1"; shift
  local f; for f in "$@"; do
    [[ -f "$f" ]] || continue
    { grep -nE "$re" "$f" || true; } | { grep -vE '^[0-9]+:[[:space:]]*#' || true; } | sed "s|^|      ${f}:|"
  done
}
alpn() { # $1=포트 $2=SNI(빈 값이면 SNI 없이) → h2 | http/1.1 | none | fail
  local out
  out="$(timeout 10 openssl s_client -connect "127.0.0.1:$1" ${2:+-servername "$2"} -alpn h2,http/1.1 </dev/null 2>/dev/null)" || true
  if grep -q '^ALPN protocol: ' <<<"$out"; then sed -n 's/^ALPN protocol: //p' <<<"$out" | head -n1
  elif grep -q 'No ALPN negotiated' <<<"$out"; then echo none
  else echo fail; fi
}

echo "== nginx2root 완화 ($([[ "$MODE" == --check ]] && echo '점검만' || echo '적용')) =="
NGX_VER="$(nginx -v 2>&1 | sed 's/^nginx version: //')"
say "nginx  : ${NGX_VER} / 패키지 $(rpm -q nginx 2>/dev/null || echo '(rpm 아님)')"
HERE="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$HERE/nginx-pin.sh" ]]; then
  # shellcheck source=nginx-pin.sh
  source "$HERE/nginx-pin.sh"
  if nginx_vulnerable "${NGX_VER#nginx/}"; then
    need "nginx ${NGX_VER#nginx/} 는 2026-11 F5 권고 취약 판(해결판 1.30.7+ / 1.31.9+) — 설정 완화로 못 막는 항목이 있다: sudo bash $HERE/nginx-upgrade.sh"
  else
    say "판     : 해결판 (1.30.7+ / 1.31.9+)"
  fi
fi
if nginx -V 2>&1 | grep -q -- '--with-http_v2_module'; then say "모듈   : http_v2 포함 (설정으로 꺼야 함)"; else say "모듈   : http_v2 없음"; fi
DUMP="$(dump_conf)" || { sed 's/^/      /' <<<"$DUMP" | tail -n 5; echo "[ERROR] nginx -T 실패 — 현재 설정이 이미 깨져 있다. 'sudo nginx -t' 로 먼저 고칠 것"; exit 1; }
mapfile -t FILES < <(conf_files "$DUMP")
OTHERS=(); for f in "${FILES[@]}"; do [[ "$f" != "$ITAM_CONF" ]] && OTHERS+=("$f"); done

echo "-- 1) itam.conf HTTP/2·HTTP/3 끄기 (CVE-2026-123007 · 123633 · 121810)"
ITAM_CHANGED=0
if [[ -f "$ITAM_CONF" ]]; then
  TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
  sed -E "${SED_FIX[@]}" "$ITAM_CONF" > "$TMP"
  if cmp -s "$ITAM_CONF" "$TMP"; then
    say "이미 완화됨 ($ITAM_CONF)"
  elif [[ "$MODE" == --check ]]; then
    say "바꿀 내용:"; diff -u "$ITAM_CONF" "$TMP" | sed -n '3,$p' | grep -E '^[-+]' | sed 's/^/      /' || true
    ACTION=$((ACTION + 1))
  else
    cp -a "$ITAM_CONF" "${ITAM_CONF}.bak-nginx2root-${TS}"
    cat "$TMP" > "$ITAM_CONF"          # 같은 inode 에 쓴다 — 권한·SELinux 라벨 유지
    ITAM_CHANGED=1
    say "수정함 (백업: ${ITAM_CONF}.bak-nginx2root-${TS})"
  fi
else
  say "$ITAM_CONF 없음 — 건너뜀"
fi

if [[ "$ITAM_CHANGED" == 1 ]]; then
  if ! T_OUT="$(nginx -t 2>&1)"; then
    sed 's/^/      /' <<<"$T_OUT"
    cp -a "${ITAM_CONF}.bak-nginx2root-${TS}" "$ITAM_CONF"
    echo "[ERROR] nginx -t 실패 — itam.conf 원복함 (서비스 영향 없음)"; exit 1
  fi
  # reload 는 열린 HTTP/2 연결을 쥔 구 워커를 남긴다 → restart
  if ! systemctl restart nginx; then
    cp -a "${ITAM_CONF}.bak-nginx2root-${TS}" "$ITAM_CONF"
    systemctl restart nginx || true
    echo "[ERROR] nginx 재시작 실패 — itam.conf 원복 후 재시작함. 'journalctl -u nginx -n 50' 확인"; exit 1
  fi
  say "nginx restart (구 워커의 기존 HTTP/2 연결까지 종료)"
  DUMP="$(dump_conf)"
fi

echo "-- 2) 공존 설정 점검 (수정하지 않음 — 해당 시스템 담당 조치)"
H2_OTHERS="$(scan "$RE_H2" "${OTHERS[@]}")"
H3_OTHERS="$(scan "$RE_H3" "${OTHERS[@]}")"
if [[ -n "$H2_OTHERS" ]]; then
  need "다른 설정이 HTTP/2 를 켠다 (CVE-2026-123007 · 123633). 1.25 미만은 같은 포트의 itam 에도 적용된다:"
  echo "$H2_OTHERS"
  say "  → 해당 담당: 'listen ... http2' 에서 http2 제거(1.25.1+ 는 'http2 off;'), nginx -t, systemctl restart nginx"
fi
if [[ -n "$H3_OTHERS" ]]; then
  need "다른 설정이 HTTP/3(QUIC) 을 켠다 (CVE-2026-121810):"
  echo "$H3_OTHERS"
  say "  → 해당 담당: quic 리스너 제거 · 'http3 off;' · Alt-Svc \"clear\" · UDP 포트 방화벽 차단"
fi
[[ -z "$H2_OTHERS$H3_OTHERS" ]] && say "HTTP/2·HTTP/3 없음 (${#OTHERS[@]}개 파일)"

echo "-- 3) DNS 해석·메일 프록시 점검 (CVE-2026-123634 · 113425)"
RES="$(scan "${D}resolver[[:space:]]" "${FILES[@]}")"
MIR="$(scan "${D}mirror[[:space:]]+[^o[:space:]]" "${FILES[@]}")"
VARPASS="$(scan "${D}(proxy|grpc|fastcgi|uwsgi|scgi)_pass[[:space:]][^;]*[\$]" "${FILES[@]}")"
MAIL="$(scan "${D}(mail[[:space:]]*[{]|auth_http[[:space:]])" "${FILES[@]}")"
if [[ -n "$RES" ]]; then
  need "요청 처리 중 DNS 조회(resolver) 사용 — 요청별 목적지 *_pass·mirror·SSI 하위 요청으로 도달 가능:"
  echo "$RES"; [[ -n "$VARPASS" ]] && { say "  변수 목적지:"; echo "$VARPASS"; }; [[ -n "$MIR" ]] && { say "  mirror:"; echo "$MIR"; }
  say "  → 고정 upstream 그룹으로 바꾸고 불필요한 mirror 는 끈다 (mirror_request_body on 은 대책 아님)"
else
  say "resolver 없음"
fi
if [[ -n "$MAIL" ]]; then
  need "mail 프록시 사용 — 로그인 자격 없이 공격 가능:"
  echo "$MAIL"
  say "  → 외부 불필요: IMAP/POP3/SMTP listen 을 127.0.0.1 로 · 필요: 방화벽으로 신뢰 IP 만"
else
  say "mail 프록시 없음 (nginx-mod-mail 은 설치돼 있어도 mail {} 이 없으면 리스너 없음)"
fi

echo "-- 4) Linux SCTP 모듈 로딩 차단 (nginx 워커 → root 상승 경로)"
if grep -rqsE '^[[:space:]]*install[[:space:]]+sctp[[:space:]]+/bin/(false|true)' /etc/modprobe.d/; then
  say "이미 차단됨 ($(grep -rlsE '^[[:space:]]*install[[:space:]]+sctp[[:space:]]' /etc/modprobe.d/ | head -n1))"
elif [[ "$MODE" == --check ]]; then
  say "미차단 — 적용 시 $SCTP_CONF 생성"; ACTION=$((ACTION + 1))
else
  mkdir -p /etc/modprobe.d
  printf '%s\n' '# nginx2root(2026-11) — Linux SCTP 권한 상승 완화. 커널 수정판 적용 후 삭제 가능.' \
    '# SCTP 를 쓰는 서비스가 생기면 이 파일을 지우고 재부팅(또는 modprobe sctp).' \
    'install sctp /bin/false' > "$SCTP_CONF"
  chmod 644 "$SCTP_CONF"; command -v restorecon >/dev/null 2>&1 && restorecon "$SCTP_CONF" || true
  say "차단 설정 생성: $SCTP_CONF (되돌리기: sudo rm -f $SCTP_CONF)"
fi
if grep -qE '^sctp ' /proc/modules 2>/dev/null; then
  need "sctp 모듈이 이미 적재돼 있다 — 사용처 없으면 'sudo modprobe -r sctp' (실패 시 재부팅). 커널 수정판 적용 필요"
elif grep -qs '/sctp\.ko' "/lib/modules/$(uname -r)/modules.builtin"; then
  need "sctp 가 커널 내장 — modprobe 차단 무효. 커널 수정판 적용 필요"
else
  say "sctp 미적재 ($(modinfo -F filename sctp >/dev/null 2>&1 && echo '모듈 있음·차단' || echo '모듈 미설치'))"
fi

echo "-- 5) 결과 확인"
ITAM_LEFT="$(scan "$RE_H2|$RE_H3" "$ITAM_CONF")"
[[ -n "$ITAM_LEFT" && "$MODE" != --check ]] && { need "itam.conf 에 HTTP/2·HTTP/3 가 남음(여러 줄 listen 등) — 직접 제거:"; echo "$ITAM_LEFT"; }
mapfile -t PORTS < <(grep -vE '^[[:space:]]*#' <<<"$DUMP" | grep -E '^[[:space:]]*listen[[:space:]][^;]*[[:space:]]ssl([[:space:];]|$)' \
  | awk '{a=$2; sub(/;$/,"",a); n=split(a,p,":"); print p[n]}' | grep -E '^[0-9]+$' | sort -un)
[[ ${#PORTS[@]} -gt 0 ]] || PORTS=(443)
SNIS=(""); [[ -n "$FQDN" ]] && SNIS=("$FQDN" "")   # itam 도메인 + SNI 없음(default_server = 공존시스템)
for p in "${PORTS[@]}"; do
  for sni in "${SNIS[@]}"; do
    r="$(alpn "$p" "$sni")"; label="${p}/${sni:-SNI없음}"
    case "$r" in
      h2)   need "ALPN ${label} → h2 — HTTP/2 가 아직 켜져 있다 (위 2) 의 공존 설정 확인)";;
      fail) need "ALPN ${label} → TLS 연결 실패 — 꺼짐으로 판단하지 말 것, nginx 상태 확인";;
      *)    say "ALPN ${label} → ${r} (h2 아님)";;
    esac
  done
done
if command -v ss >/dev/null 2>&1 && ss -lunp 2>/dev/null | grep -q '"nginx"'; then
  need "nginx 가 UDP 를 듣고 있다(QUIC/HTTP3 의심): $(ss -lunp 2>/dev/null | grep '"nginx"' | awk '{print $5}' | tr '\n' ' ')"
fi
if pgrep -f 'nginx: worker process is shutting down' >/dev/null 2>&1; then
  need "종료 대기 중인 구 워커가 남아 있다 — 'sudo systemctl restart nginx'"
fi

echo "== nginx2root 요약 =="
say "설정 완화는 임시 조치다. nginx 는 수정판(1.30.7+ / 1.31.9+ — nginx-upgrade.sh), 커널은 수정판 반입으로 교체할 것"
say "현재: ${NGX_VER} ($(rpm -q nginx 2>/dev/null || echo '-'))"
if [[ "$ITAM_CHANGED" == 1 ]]; then
  say "되돌리기(HTTP/2 재활성 — 권장하지 않음): sudo cp -a ${ITAM_CONF}.bak-nginx2root-${TS} ${ITAM_CONF} && sudo nginx -t && sudo systemctl restart nginx"
fi
if [[ "$ACTION" -gt 0 ]]; then
  say "조치 필요 ${ACTION}건 — 위 [조치 필요] 항목 확인"; exit 2
fi
say "완화 상태 정상"
exit 0

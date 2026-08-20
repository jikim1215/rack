#!/usr/bin/env bash
# ============================================================
# itam 전용 TLS 인증서 갱신 — nginx(itam)에만 적용.
#   ★ 공존시스템(shared.crt/key)와 asset-inventory 앱에는 절대 영향 없음:
#     - itam 전용 경로(/etc/ssl/itam)에만 쓰기. 공존시스템의 /etc/ssl/certs/shared.* 는 읽지도 쓰지도 않음.
#     - /etc/nginx/conf.d/itam.conf 의 ssl_certificate 두 줄만 itam 경로로 유지(다른 vhost 무변경).
#     - 적용은 `nginx -t` 검증 후 `systemctl reload nginx`(graceful) 뿐 — 앱 서비스 재시작 없음,
#       TLS는 nginx 계층 전용이라 Next 앱(127.0.0.1:3100)은 인증서를 보지 않는다.
#     - 기존 연결 유지(reload). 공존시스템 vhost의 설정·인증서는 재읽기만 될 뿐 그대로다.
#
# 사용법:
#   sudo bash renew-cert.sh <새_fullchain.crt> <새_privkey.key>   # 갱신(설치+검증+reload)
#   sudo bash renew-cert.sh check                                  # 현재 itam 인증서 만료 확인
#
# 환경변수(선택): FQDN(기본 itam.example.go.kr) · ITAM_CRT · ITAM_KEY
# ============================================================
set -euo pipefail

FQDN="${FQDN:-itam.example.go.kr}"
ITAM_DIR="/etc/ssl/itam"
ITAM_CRT="${ITAM_CRT:-$ITAM_DIR/itam.crt}"     # fullchain (leaf + chain)
ITAM_KEY="${ITAM_KEY:-$ITAM_DIR/itam.key}"
CONF="/etc/nginx/conf.d/itam.conf"
# 공존시스템 공유 인증서(보호 대상 — 절대 대상이 되면 안 됨)
KFLOW_CRT="/etc/ssl/certs/shared.crt"
KFLOW_KEY="/etc/ssl/private/shared.key"

die(){ echo -e "\033[1;31m[중단] $*\033[0m" >&2; exit 1; }
rp(){ readlink -f "$1" 2>/dev/null || echo "$1"; }

[[ $(id -u) -eq 0 ]] || die "root 필요: sudo bash renew-cert.sh <crt> <key>"

# ── check 서브커맨드: itam 인증서 만료/주체 확인 ──
if [[ "${1:-}" == "check" ]]; then
  [[ -s "$ITAM_CRT" ]] || die "itam 인증서 없음: $ITAM_CRT (아직 전용 인증서로 전환 전일 수 있음 — 현재 참조: $(grep -oE 'ssl_certificate[[:space:]]+[^;]+' "$CONF" 2>/dev/null | head -1))"
  echo "  경로   : $ITAM_CRT"
  echo "  주체   : $(openssl x509 -in "$ITAM_CRT" -noout -subject | sed 's/subject=//')"
  echo "  만료   : $(openssl x509 -in "$ITAM_CRT" -noout -enddate | sed 's/notAfter=//')"
  end_epoch="$(date -d "$(openssl x509 -in "$ITAM_CRT" -noout -enddate | sed 's/notAfter=//')" +%s 2>/dev/null || echo 0)"
  [[ "$end_epoch" -gt 0 ]] && echo "  남은일 : $(( (end_epoch - $(date +%s)) / 86400 ))일"
  exit 0
fi

NEW_CRT="${1:-}"; NEW_KEY="${2:-}"
[[ -s "$NEW_CRT" && -s "$NEW_KEY" ]] || die "사용법: sudo bash renew-cert.sh <새_fullchain.crt> <새_privkey.key>"

# ── 안전장치: itam 대상 경로가 공존시스템 공유 인증서를 가리키면 거부(공유 인증서 오염 방지) ──
for p in "$ITAM_CRT" "$ITAM_KEY"; do
  case "$(rp "$p")" in
    "$(rp "$KFLOW_CRT")"|"$(rp "$KFLOW_KEY")") die "itam 대상 경로가 공존시스템 공유 인증서를 가리킵니다 — 거부(공존시스템 보호)." ;;
  esac
done

echo "== 1) 새 인증서/키 검증 =="
openssl x509 -in "$NEW_CRT" -noout >/dev/null 2>&1 || die "유효한 인증서(PEM)가 아닙니다: $NEW_CRT"
openssl pkey -in "$NEW_KEY" -noout >/dev/null 2>&1 || die "유효한 개인키가 아닙니다: $NEW_KEY"
c_hash="$(openssl x509 -in "$NEW_CRT" -noout -pubkey 2>/dev/null | openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256 | awk '{print $NF}')"
k_hash="$(openssl pkey -in "$NEW_KEY" -pubout -outform DER 2>/dev/null | openssl dgst -sha256 | awk '{print $NF}')"
[[ -n "$c_hash" && "$c_hash" == "$k_hash" ]] || die "인증서와 개인키가 서로 매칭되지 않습니다."
openssl x509 -in "$NEW_CRT" -noout -checkhost "$FQDN" >/dev/null 2>&1 || echo "  [경고] 인증서가 $FQDN 를 커버하지 않을 수 있음(브라우저 경고 가능)."
echo "  주체 : $(openssl x509 -in "$NEW_CRT" -noout -subject | sed 's/subject=//')"
echo "  만료 : $(openssl x509 -in "$NEW_CRT" -noout -enddate | sed 's/notAfter=//')"

echo "== 2) itam 전용 경로에 설치(+백업) =="
[[ -f "$CONF" ]] || die "itam.conf 없음: $CONF (itam 설치 후 실행하세요)"
mkdir -p "$ITAM_DIR"; chmod 755 "$ITAM_DIR"
ts="$(date +%Y%m%d-%H%M%S)"
[[ -f "$ITAM_CRT" ]] && cp -a "$ITAM_CRT" "$ITAM_CRT.bak-$ts"
[[ -f "$ITAM_KEY" ]] && cp -a "$ITAM_KEY" "$ITAM_KEY.bak-$ts"
install -m 644 "$NEW_CRT" "$ITAM_CRT.new" && mv -f "$ITAM_CRT.new" "$ITAM_CRT"
install -m 600 "$NEW_KEY" "$ITAM_KEY.new" && mv -f "$ITAM_KEY.new" "$ITAM_KEY"
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" != "Disabled" ]; then
  chcon -t cert_t "$ITAM_CRT" "$ITAM_KEY" 2>/dev/null || restorecon "$ITAM_CRT" "$ITAM_KEY" 2>/dev/null || true
fi

echo "== 3) itam.conf 인증서 경로를 itam 전용으로 고정(멱등, itam vhost만) =="
cp -a "$CONF" "$CONF.bak-$ts"
sed -i -E "s#^([[:space:]]*ssl_certificate[[:space:]]+)[^;]+;#\1$ITAM_CRT;#; s#^([[:space:]]*ssl_certificate_key[[:space:]]+)[^;]+;#\1$ITAM_KEY;#" "$CONF"

echo "== 4) nginx 검증 + graceful reload =="
if ! nginx -t; then
  echo "  [롤백] nginx -t 실패 → 이전 인증서·conf 복구"
  [[ -f "$ITAM_CRT.bak-$ts" ]] && mv -f "$ITAM_CRT.bak-$ts" "$ITAM_CRT"
  [[ -f "$ITAM_KEY.bak-$ts" ]] && mv -f "$ITAM_KEY.bak-$ts" "$ITAM_KEY"
  cp -a "$CONF.bak-$ts" "$CONF"
  nginx -t && systemctl reload nginx || true
  die "nginx 검증 실패 — 원복 완료. 인증서/체인을 확인하세요."
fi
systemctl reload nginx

echo "== 완료 =="
IP="$(hostname -I | awk '{print $1}')"
code="$(curl -sk --resolve "$FQDN:443:$IP" -o /dev/null -w '%{http_code}' "https://$FQDN/login" 2>/dev/null || echo 000)"
echo "  https://$FQDN/login → $code (200/302/307 기대)"
echo "  적용 : $ITAM_CRT (만료 $(openssl x509 -in "$ITAM_CRT" -noout -enddate | sed 's/notAfter=//'))"
echo "  ※ 공존시스템(shared.crt/key)·asset-inventory 서비스는 건드리지 않았습니다(nginx reload만)."

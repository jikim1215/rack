#!/usr/bin/env bash
# ============================================================
# upgrade-inplace.sh 직전 상태로 되돌리기
#   sudo bash rollback.sh <시각>            # 앱 트리만 (DB·nginx 그대로) — 보통 이것
#   sudo bash rollback.sh <시각> --with-db  # DB 도 업그레이드 직전 백업으로 (그 사이 입력한 데이터는 사라진다)
#   <시각> = 업그레이드 출력의 YYYYMMDD_HHMMSS (/opt/asset-inventory.rollback-<시각>)
#
# 앱 트리는 **통째로 교체**한다(덮어쓰기 아님): 새 판에만 있는 파일(.next 청크·스크립트)이 남아
# 구판과 섞이지 않게. nginx itam.conf 는 업그레이드가 바꿨을 때만(백업 파일이 있을 때) 되돌린다.
# 이 스크립트는 업그레이드가 롤백본 안에도 복사해 둔다 — 되돌린 뒤 구판 트리에 없어도 다시 쓸 수 있다.
# ============================================================
set -euo pipefail
TS="${1:-}"; WITH_DB="${2:-}"
APP=/opt/asset-inventory
APP_USER=asset
RB="/opt/asset-inventory.rollback-${TS}"
NGX_CONF=/etc/nginx/conf.d/itam.conf
REPLACE=(.next src scripts docs node_modules package.json package-lock.json next.config.ts)

[[ $(id -u) -eq 0 ]] || { echo "[ERROR] root 필요: sudo bash $0 <시각> [--with-db]"; exit 1; }
[[ -n "$TS" && -d "$RB" ]] || { echo "[ERROR] 롤백본 없음: ${RB:-<시각 미지정>}"; ls -d /opt/asset-inventory.rollback-* 2>/dev/null | sed 's/^/   후보: /'; exit 1; }
[[ -f "$RB/.next/standalone/server.js" ]] || { echo "[ERROR] 롤백본이 불완전합니다(.next/standalone/server.js 없음): $RB"; exit 1; }
DB_BAK="$APP/backups/data.db.preupgrade-${TS}.gz"
if [[ "$WITH_DB" == "--with-db" ]]; then
  [[ -f "$DB_BAK" ]] || { echo "[ERROR] DB 백업 없음: $DB_BAK"; exit 1; }
elif [[ -n "$WITH_DB" ]]; then
  echo "[ERROR] 알 수 없는 옵션: $WITH_DB (--with-db 만 지원)"; exit 1
fi
INTERNAL_PORT="$(grep -E '^PORT=' "$APP/.env" 2>/dev/null | cut -d= -f2 || echo 3100)"
FQDN="$(grep -E '^PUBLIC_FQDN=' "$APP/.env" 2>/dev/null | cut -d= -f2 || hostname -f)"

echo "== 1) 서비스 중지 =="
systemctl stop asset-inventory

echo "== 2) 앱 트리 교체 (롤백본 → $APP, data.db/.env/node/tls/backups 미변경) =="
for d in "${REPLACE[@]}"; do rm -rf "${APP:?}/${d:?}"; done
for d in "${REPLACE[@]}"; do [[ -e "$RB/$d" ]] && cp -a "$RB/$d" "$APP/"; done
chown -R "${APP_USER}:${APP_USER}" "$APP"

if [[ "$WITH_DB" == "--with-db" ]]; then
  echo "== 3) DB 복원 ($DB_BAK) =="
  sudo -u "$APP_USER" sh -c "gunzip -c '$DB_BAK' > '$APP/data.db'"
  rm -f "$APP/data.db-wal" "$APP/data.db-shm"
  chmod 600 "$APP/data.db"
else
  echo "== 3) DB 유지 (되돌리려면 --with-db) =="
fi

echo "== 4) nginx =="
if [[ -f "${NGX_CONF}.bak-${TS}" ]]; then
  cp -a "$NGX_CONF" "${NGX_CONF}.pre-rollback-${TS}"
  cp -a "${NGX_CONF}.bak-${TS}" "$NGX_CONF"
  if nginx -t >/dev/null 2>&1; then systemctl reload nginx; echo "   itam.conf 복원 + reload"
  else mv -f "${NGX_CONF}.pre-rollback-${TS}" "$NGX_CONF"; echo "   ✗ nginx -t 실패 — 현재 설정 유지"; fi
else
  echo "   업그레이드가 itam.conf 를 바꾸지 않음 — 그대로"
fi

echo "== 5) 기동 =="
systemctl start asset-inventory
CODE=000
for _ in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${FQDN}" "http://127.0.0.1:${INTERNAL_PORT}/api/health" || true)
  [[ "$CODE" == "200" ]] && break
  sleep 2
done
echo "   /api/health → ${CODE} (서비스: $(systemctl is-active asset-inventory))"
[[ "$CODE" == "200" ]] || { echo "[ERROR] 기동 확인 실패 — journalctl -u asset-inventory -n 50"; exit 1; }
echo "== 롤백 완료 ($RB) =="

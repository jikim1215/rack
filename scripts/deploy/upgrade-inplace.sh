#!/usr/bin/env bash
# ============================================================
# 운영 중인 /opt/asset-inventory 를 새 번들로 in-place 업그레이드
#   보존: data.db(+WAL/SHM) · .env · node/ · tls/ · backups/   ← 운영 데이터·시크릿·런타임은 건드리지 않는다
#   교체: .next · src · scripts · docs · node_modules · package*.json · next.config.ts
#   nginx: itam.conf 의 X-Forwarded-For 한 줄만 현행화(백업 → nginx -t → reload, 실패 시 복원)
#   롤백: /opt/asset-inventory.rollback-<TS> 에 이전 앱 트리 + rollback.sh 보관 (스크립트 말미에 명령 출력)
#
# 사용: sudo bash upgrade-inplace.sh [번들경로 | __BUNDLE_TREE__:<이미_풀린_번들디렉터>]
#   기본 번들: ~/asset/dist/asset-inventory-offline.tar.gz (build-release.sh 산출물)
#   폐쇄망 반입 시엔 deploy.sh 가 풀린 트리를 직접 넘긴다(재압축 불필요).
#
# 주의: 앱 첫 기동 시 getDb() 가 스키마 마이그레이션을 실행한다(메뉴 권한 시드, audit_logs/import_issue
#       CHECK 확장, feedback 테이블 생성, user_version 2 날짜 정규화). 그래서 1단계에서 DB 를 먼저 백업한다.
#       7-1 단계는 구판 결함(재기동마다 자산 소유팀·L/R·현행화 도장 유실)으로 비워진 값을 감사로그에서 복구한다.
# ============================================================
set -euo pipefail
BUNDLE="${1:-$HOME/asset/dist/asset-inventory-offline.tar.gz}"
APP=/opt/asset-inventory
APP_USER=asset
INTERNAL_PORT="$(grep -E '^PORT=' "$APP/.env" 2>/dev/null | cut -d= -f2 || echo 3100)"
FQDN="$(grep -E '^PUBLIC_FQDN=' "$APP/.env" 2>/dev/null | cut -d= -f2 || hostname -f)"
TS=$(date +%Y%m%d_%H%M%S)
ROLLBACK="/opt/asset-inventory.rollback-${TS}"
STAGE="/tmp/asset-upgrade-${TS}"
REPLACE=(.next src scripts docs node_modules package.json package-lock.json next.config.ts)

[[ $(id -u) -eq 0 ]] || { echo "[ERROR] root 필요: sudo bash $0"; exit 1; }
[[ -d "$APP" ]] || { echo "[ERROR] 기존 설치 없음: $APP (신규 설치는 setup-nginx.sh)"; exit 1; }

# 번들 입력: tar.gz 또는 이미 풀린 트리(__BUNDLE_TREE__:<경로>)
PRE_EXTRACTED=""
if [[ "$BUNDLE" == __BUNDLE_TREE__:* ]]; then
  PRE_EXTRACTED="${BUNDLE#__BUNDLE_TREE__:}"
  [[ -f "${PRE_EXTRACTED}/.next/standalone/server.js" ]] || { echo "[ERROR] 번들 트리 이상: $PRE_EXTRACTED"; exit 1; }
else
  [[ -f "$BUNDLE" ]] || { echo "[ERROR] 번들 없음: $BUNDLE"; exit 1; }
fi

echo "== 0) 대상 확인 =="
if [[ -n "$PRE_EXTRACTED" ]]; then
  echo "   번들 : $PRE_EXTRACTED (전개됨)"
else
  echo "   번들 : $BUNDLE ($(du -h "$BUNDLE" | cut -f1))"
fi
echo "   앱   : $APP (내부포트 ${INTERNAL_PORT}, FQDN ${FQDN})"

echo "== 1) DB 백업 (WAL 안전 online backup) =="
sudo -u "$APP_USER" "$APP/node/bin/node" \
  -e 'const D=require(process.argv[1]+"/.next/standalone/node_modules/better-sqlite3");
      const db=new D(process.argv[1]+"/data.db",{readonly:true});
      db.backup(process.argv[1]+"/backups/data.db.preupgrade-"+process.argv[2])
        .then(()=>{console.log("   backup ok");process.exit(0)})
        .catch(e=>{console.error(e);process.exit(1)});' "$APP" "$TS"
gzip -f "$APP/backups/data.db.preupgrade-${TS}"
chmod 600 "$APP/backups/data.db.preupgrade-${TS}.gz"   # gzip 기본 644 — 보안 체크리스트는 백업 600 요구
ls -lh "$APP/backups/data.db.preupgrade-${TS}.gz" | sed 's/^/   /'

echo "== 2) 번들 전개 =="
if [[ -n "$PRE_EXTRACTED" ]]; then
  SRC="$PRE_EXTRACTED"
  echo "   이미 전개된 트리 사용 (재압축 생략)"
else
  mkdir -p "$STAGE"
  tar -xzf "$BUNDLE" -C "$STAGE"
  SRC="$STAGE/asset-inventory"
fi
[[ -f "$SRC/.next/standalone/server.js" ]] || { echo "[ERROR] 번들 구조 이상 (standalone/server.js 없음)"; exit 1; }

echo "== 3) 서비스 중지 =="
systemctl stop asset-inventory

echo "== 4) 롤백본 보관 =="
mkdir -p "$ROLLBACK"
for d in "${REPLACE[@]}"; do [[ -e "$APP/$d" ]] && cp -a "$APP/$d" "$ROLLBACK/"; done
# 되돌리기 스크립트는 새 판 것을 롯백본 최상위에도 둔다(구판 트리에는 없을 수 있다)
[[ -f "$SRC/scripts/deploy/rollback.sh" ]] && cp -a "$SRC/scripts/deploy/rollback.sh" "$ROLLBACK/rollback.sh"
echo "   $ROLLBACK ($(du -sh "$ROLLBACK" | cut -f1))"

echo "== 5) 앱 트리 교체 (data.db/.env/node/tls/backups 미변경) =="
for d in "${REPLACE[@]}"; do rm -rf "${APP:?}/${d:?}"; done
for d in "${REPLACE[@]}"; do [[ -e "$SRC/$d" ]] && cp -a "$SRC/$d" "$APP/"; done
chown -R "${APP_USER}:${APP_USER}" "$APP"
chmod 600 "$APP/.env"
chmod 600 "$APP/data.db" 2>/dev/null || true

echo "== 6) native smoke =="
sudo -u "$APP_USER" "$APP/node/bin/node" \
  -e 'require(process.argv[1]+"/.next/standalone/node_modules/better-sqlite3");console.log("   native ok")' "$APP"

echo "== 6-1) nginx 프록시 헤더 현행화 (X-Forwarded-For 덮어쓰기 — 클라이언트 IP 위조 차단) =="
# 구버전 itam.conf 는 $proxy_add_x_forwarded_for(클라이언트 값에 덧붙임)를 썼다. 그 한 줄만 $remote_addr 로 바꾸고
# nginx -t 통과 시에만 reload, 실패하면 원본 복원. 인증서·포트 등 다른 설정은 건드리지 않는다.
NGX_CONF=/etc/nginx/conf.d/itam.conf
if [[ -f "$NGX_CONF" ]] && grep -q 'X-Forwarded-For[[:space:]]*\$proxy_add_x_forwarded_for' "$NGX_CONF"; then
  cp -a "$NGX_CONF" "${NGX_CONF}.bak-${TS}"
  sed -i 's/\(X-Forwarded-For[[:space:]]*\)\$proxy_add_x_forwarded_for/\1$remote_addr/' "$NGX_CONF"
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    echo "   ✓ itam.conf 갱신 + nginx reload (백업: ${NGX_CONF}.bak-${TS})"
  else
    mv -f "${NGX_CONF}.bak-${TS}" "$NGX_CONF"
    echo "   ✗ nginx -t 실패 — 원본 복원(앱 측 방어는 유효). 'sudo nginx -t' 로 원인 확인"
  fi
elif [[ -f "$NGX_CONF" ]]; then
  echo "   이미 최신 (변경 없음)"
else
  echo "   $NGX_CONF 없음 — 건너뜀(nginx 미사용 구성)"
fi

# /api/health 는 getDb() 를 호출한다 = 스키마 마이그레이션이 끝난 뒤에야 200. (DB 는 첫 요청에서 열린다 — 기동만으로는 미실행)
wait_health() {
  local code=000
  for _ in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${FQDN}" "http://127.0.0.1:${INTERNAL_PORT}/api/health" || true)
    [[ "$code" == "200" ]] && break
    sleep 2
  done
  echo "   /api/health → ${code} (서비스: $(systemctl is-active asset-inventory))"
}

echo "== 7) 기동 (첫 요청 = 스키마 마이그레이션) =="
systemctl start asset-inventory
wait_health

echo "== 7-1) 재기동 유실 값 복구 (소유 팀·랙 L/R·현행 확인 도장·일괄등록 배치 — 감사로그 재생) =="
# 2026-10-01 이전 판은 기동할 때마다 위 값을 비웠다. 빈 필드만 감사로그의 마지막 기록값으로 채운다(현재 값 불변).
# 새 판 첫 기동이 컬럼을 보강한 뒤에 서비스를 잠깐 멈추고 실행한다(단독 쓰기). 실패해도 업그레이드는 계속.
RESTORE="$APP/scripts/deploy/restore-lost-fields.cjs"
if [[ -f "$RESTORE" ]]; then
  systemctl stop asset-inventory
  if OUT=$(sudo -u "$APP_USER" APP_DIR="$APP" "$APP/node/bin/node" "$RESTORE" --apply 2>&1); then
    sed 's/^/   /' <<<"$OUT"
  else
    sed 's/^/   /' <<<"$OUT"
    echo "   ✗ 복구 실패 — 서비스는 정상 기동한다. 미리보기: sudo -u ${APP_USER} $APP/node/bin/node $RESTORE"
  fi
  systemctl start asset-inventory
  wait_health
fi

echo "== 8) 스모크 =="
CODE=000
for _ in 1 2 3 4 5; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${FQDN}" "http://127.0.0.1:${INTERNAL_PORT}/login" || true)
  [[ "$CODE" =~ ^(200|302|307)$ ]] && break
  sleep 3
done
echo "   내부 /login → ${CODE}"
CSP=$(curl -s -D - -o /dev/null -H "Host: ${FQDN}" "http://127.0.0.1:${INTERNAL_PORT}/login" | grep -i '^content-security-policy' || true)
if grep -q 'nonce-' <<<"$CSP"; then echo "   ✓ nonce CSP 적용"; else echo "   ✗ nonce CSP 미적용 — 확인 필요"; fi
curl -sk -o /dev/null -w '   https(nginx) /login → %{http_code}\n' -H "Host: ${FQDN}" https://127.0.0.1/login || true

echo "== 9) 마이그레이션 결과 =="
sudo -u "$APP_USER" "$APP/node/bin/node" \
  -e 'const D=require(process.argv[1]+"/.next/standalone/node_modules/better-sqlite3");
      const db=new D(process.argv[1]+"/data.db",{readonly:true});
      console.log("   user_version:", db.pragma("user_version",{simple:true}));
      for (const t of ["assets","users","teams","menu_permissions","audit_logs","feedback","feedback_votes"]) {
        try { console.log("   "+t+":", db.prepare("SELECT COUNT(*) c FROM "+t).get().c); }
        catch { console.log("   "+t+": (없음)"); }
      }' "$APP"

rm -rf "$STAGE"
echo ""
echo "== 업그레이드 완료 =="
echo "   DB 백업 : $APP/backups/data.db.preupgrade-${TS}.gz"
echo "   롤백본  : $ROLLBACK"
echo "   롤백 명령 (앱 트리 + 바뀐 경우 nginx — DB 는 유지):"
echo "     sudo bash $ROLLBACK/rollback.sh ${TS}"
echo "   DB 까지 업그레이드 직전으로 (그 사이 입력분 사라짐):"
echo "     sudo bash $ROLLBACK/rollback.sh ${TS} --with-db"
echo "   DB 점검(읽기 전용):"
echo "     sudo -u ${APP_USER} $APP/node/bin/node $APP/scripts/deploy/db-query.cjs summary"

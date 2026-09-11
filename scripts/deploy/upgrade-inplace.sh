#!/usr/bin/env bash
# ============================================================
# 운영 중인 /opt/asset-inventory 를 새 번들로 in-place 업그레이드
#   보존: data.db(+WAL/SHM) · .env · node/ · tls/ · backups/   ← 운영 데이터·시크릿·런타임은 건드리지 않는다
#   교체: .next · src · scripts · docs · node_modules · package*.json · next.config.ts
#   롤백: /opt/asset-inventory.rollback-<TS> 에 이전 앱 트리 보관 (스크립트 말미에 복원 명령 출력)
#
# 사용: sudo bash upgrade-inplace.sh [번들경로 | __BUNDLE_TREE__:<이미_풀린_번들디렉터>]
#   기본 번들: ~/asset/dist/asset-inventory-offline.tar.gz (build-release.sh 산출물)
#   폐쇄망 반입 시엔 deploy.sh 가 풀린 트리를 직접 넘긴다(재압축 불필요).
#
# 주의: 앱 첫 기동 시 getDb() 가 스키마 마이그레이션을 실행한다(메뉴 권한 시드, audit_logs/import_issue
#       CHECK 확장, feedback 테이블 생성, user_version 2 날짜 정규화). 그래서 1단계에서 DB 를 먼저 백업한다.
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

echo "== 7) 기동 =="
systemctl start asset-inventory
sleep 6
echo "   서비스: $(systemctl is-active asset-inventory)"

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
echo "   롤백 명령:"
echo "     sudo systemctl stop asset-inventory && sudo cp -a $ROLLBACK/. $APP/ && sudo chown -R ${APP_USER}:${APP_USER} $APP && sudo systemctl start asset-inventory"

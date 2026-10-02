#!/bin/bash
# ============================================================
# asset-inventory 오프라인 릴리스 번들러 (AC-15/16)
# 대상 OS: Rocky Linux 8.10 x86_64 (glibc 2.28). 동일 OS에서 재현 빌드해야 native ABI 일치.
# 산출물: dist/asset-inventory-offline.tar.gz (앱 + 번들 Node + native + 배포 스크립트)
# 버전: package.json version + 커밋 + 빌드 시각을 화면·/api/health 에 박고, 번들 최상위 VERSION 파일로도 남긴다.
#   커밋은 APP_COMMIT(지정 시) > git(APP_GIT_DIR 또는 이 저장소). 소스를 복사해 빌드하면(.git 없음)
#   APP_GIT_DIR=<원본 저장소> 를 넘긴다. 미커밋 변경이 있으면 커밋 뒤에 -dirty 가 붙는다(정식 릴리스는 태그 후 깨끗한 트리).
# Plan B: better-sqlite3 prebuilt 로드 실패 대비 소스 리빌드 산출물 동봉.
# ============================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="${ROOT}/dist"
STAGE="${DIST}/asset-inventory"
NODE_TARBALL="${NODE_TARBALL:-${ROOT}/vendor/node-linux-x64.tar.xz}"

echo "== 오프라인 릴리스 빌드 (Rocky 8.10 / glibc 2.28 가정) =="

# ── 0. 동일 OS / glibc 2.28 검증 (ABI 재현성, AC-16) ──
#   주의: `ldd|head|grep|head || echo 0` 패턴은 pipefail에서 head의 조기 종료(SIGPIPE)로
#   파이프가 비정상 종료 판정되면 `|| echo 0`이 붙어 GLIBC="2.28\n0"가 되는 플래키 버그가 있다.
#   → line1을 먼저 변수로 받은 뒤 추출하고, 빈 값만 :-0 폴백(문자열 오염 방지).
GLIBC_LINE="$(ldd --version 2>/dev/null | head -1)"
GLIBC="$(printf '%s' "$GLIBC_LINE" | grep -oE '[0-9]+\.[0-9]+' | head -1)"
GLIBC="${GLIBC:-0}"
echo "[INFO] glibc=${GLIBC}"
if [[ "${ALLOW_GLIBC_MISMATCH:-0}" != "1" && "${GLIBC}" != "2.28" ]]; then
  echo "[ERROR] glibc ${GLIBC} != 2.28 — Rocky 8.10에서 빌드해야 native(better-sqlite3) ABI가 타깃과 일치합니다."
  echo "        (CI에서 다른 OS로 검증만 할 때는 ALLOW_GLIBC_MISMATCH=1)"
  exit 1
fi

# ── 1. 클린 빌드 ──
cd "$ROOT"
rm -rf .next dist
npm ci --no-audit --no-fund
# 빌드 메타를 한 번만 계산해 env 로 고정 → next build(화면·health)와 아래 VERSION 파일이 같은 값을 쓴다.
META="$(node scripts/build-meta.mjs)"
export APP_VERSION="$(sed -n 's/^APP_VERSION=//p' <<<"$META")"
export APP_COMMIT="$(sed -n 's/^APP_COMMIT=//p' <<<"$META")"
export APP_BUILT_AT="$(sed -n 's/^APP_BUILT_AT=//p' <<<"$META")"
[[ -n "$APP_VERSION" && -n "$APP_BUILT_AT" ]] || { echo "[ERROR] 빌드 메타 계산 실패: $META"; exit 1; }
echo "[INFO] 버전 v${APP_VERSION} · 커밋 ${APP_COMMIT:-(없음)} · 빌드 ${APP_BUILT_AT}"
[[ "$APP_COMMIT" == *-dirty ]] && echo "[WARN] 미커밋 변경이 있는 소스 — 정식 릴리스는 커밋·태그 후 다시 빌드"
NEXT_TELEMETRY_DISABLED=1 npm run build
[[ -f .next/standalone/server.js ]] || { echo "[ERROR] standalone 빌드 산출물 없음 (next.config output:'standalone' 확인)"; exit 1; }

# ── 2. 스테이징 ──
mkdir -p "$STAGE"
printf 'version=%s\ncommit=%s\nbuilt_at=%s\n' "$APP_VERSION" "$APP_COMMIT" "$APP_BUILT_AT" > "$STAGE/VERSION"
cp -a .next "$STAGE/.next"
# .next/cache 는 빌드 증분 캐시(webpack, ~170MB)다. 런타임(standalone/server.js)은 참조하지 않는다 — 번들에서 제외.
rm -rf "$STAGE/.next/cache"
cp -a public "$STAGE/public" 2>/dev/null || true
cp -a src "$STAGE/src"            # 런타임 라이브러리(db/authz/retention/asset-rules…) — retention-runner/import 스크립트가 사용
cp -a scripts "$STAGE/scripts"
# scripts/ 정리 — 배포/런타임 불필요 자산 제거.
#   유지: db-seed.mjs(설치 최소초기화) + smoke.mjs(배포 후 확인 — DEPLOY.md §6 이 지시하는 게이트,
#         외부 의존 없이 node 내장 crypto/fetch 만 쓴다) + deploy/*(설치·백업·systemd).
#         ※ deploy/ 하위는 아래에서 별도 정리.
#   제거: 루트의 1회용 데이터가공/검증/e2e 스크립트(*.mjs,*.ts) + AI 리뷰 닷파일(scripts/.*) + 모든 Windows .ps1.
find "$STAGE/scripts" -maxdepth 1 -type f ! -name 'db-seed.mjs' ! -name 'smoke.mjs' -delete
find "$STAGE/scripts" -name '*.ps1' -delete
# next 빌드가 standalone 으로 잘못 트레이스한 개발 산출물(scripts/.serial-verify-list.json 등) 제거.
#   런타임은 standalone/scripts 를 참조하지 않는다(라우트는 src/lib 만 사용).
rm -rf "$STAGE/.next/standalone/scripts"
cp -a package.json package-lock.json next.config.ts "$STAGE/" 2>/dev/null || true
cp -a docs "$STAGE/docs" 2>/dev/null || true   # 운영/사용자 매뉴얼 등 문서 동봉 (서버에서 참조: docs/관리자매뉴얼.md)
# standalone이 참조하는 static/public 동봉
mkdir -p "$STAGE/.next/standalone/.next"
cp -a .next/static "$STAGE/.next/standalone/.next/static"
cp -a public "$STAGE/.next/standalone/public" 2>/dev/null || true

# ── 3. native(better-sqlite3) 산출물 + Plan B ──
mkdir -p "$STAGE/node_modules/better-sqlite3"
cp -a node_modules/better-sqlite3 "$STAGE/node_modules/" 2>/dev/null || true
PREBUILT="$STAGE/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
if [[ -f "$PREBUILT" ]]; then
  echo "[OK] prebuilt native 동봉: $(basename "$PREBUILT")"
else
  echo "[WARN] prebuilt 없음 — 타깃에서 Plan B(native-planb.sh) 소스 리빌드 필요"
fi
# 앱(standalone)은 .next/standalone/node_modules/better-sqlite3 에서 native를 로드한다(serverExternalPackages).
# Next가 트레이싱으로 복사하지 못한 경우를 대비해 명시적으로 동봉 (setup.sh native smoke와 동일 경로).
SA_BS="$STAGE/.next/standalone/node_modules/better-sqlite3"
if [[ ! -f "$SA_BS/build/Release/better_sqlite3.node" ]]; then
  mkdir -p "$(dirname "$SA_BS")"
  cp -a node_modules/better-sqlite3 "$(dirname "$SA_BS")/" 2>/dev/null || true
fi
[[ -f "$SA_BS/build/Release/better_sqlite3.node" ]] && echo "[OK] standalone native 동봉: .next/standalone/node_modules/better-sqlite3" || echo "[WARN] standalone native 미동봉 — 타깃 Plan B 필요"
# Plan B: 타깃에서 재빌드 가능하도록 소스/빌드툴 메모 + 리빌드 스크립트 동봉
cat > "$STAGE/scripts/deploy/native-planb.sh" <<'PB'
#!/bin/bash
# Plan B: native better-sqlite3 로드 실패 시 타깃 OS에서 소스 리빌드.
set -euo pipefail
cd "$(dirname "$0")/../.."
echo "[planb] better-sqlite3 소스 리빌드 (gcc/make/python3 필요)"
./node/bin/npm rebuild better-sqlite3 --build-from-source
# 앱이 실제 로드하는 standalone 경로에도 리빌드 산출물 반영
if [[ -d .next/standalone/node_modules/better-sqlite3 ]]; then
  cp -a node_modules/better-sqlite3/build .next/standalone/node_modules/better-sqlite3/ 2>/dev/null || true
fi
./node/bin/node -e "require('./.next/standalone/node_modules/better-sqlite3'); console.log('[planb] standalone native 리빌드 후 로드 OK')" \
  || ./node/bin/node -e "require('better-sqlite3'); console.log('[planb] native 리빌드 후 로드 OK')"
PB
chmod +x "$STAGE/scripts/deploy/native-planb.sh"

# ── 3-1. 폐쇄망 외부접속 자산 동봉 (nginx RPM + nginx conf) — 인증서는 공존시스템 공유라 미동봉 ──
# nginx는 오프라인 설치를 위해 사전에 vendor/rpms/ 에 받아둔 RPM을 사용한다.
#   (인터넷 되는 시점에 1회: dnf download --resolve --destdir vendor/rpms nginx)
mkdir -p "$STAGE/rpms"
if compgen -G "${ROOT}/vendor/rpms/*.rpm" >/dev/null 2>&1; then
  cp -a "${ROOT}/vendor/rpms/"*.rpm "$STAGE/rpms/" 2>/dev/null || true
  echo "[OK] nginx/런타임 RPM 동봉: $(ls "$STAGE/rpms" | tr '\n' ' ')"
else
  echo "[WARN] vendor/rpms/*.rpm 없음 — nginx 오프라인 설치 불가. 인터넷 PC에서 'dnf download --resolve --destdir vendor/rpms nginx' 후 재빌드"
fi
# 정식 SSL 인증서는 번들에 넣지 않는다 — itam 은 공존시스템(share)의 인증서를 공유한다.
#   실서버에 이미 배치된 /etc/ssl/certs/shared.crt (*.example.go.kr) 를 setup-nginx.sh 가 참조.
#   (독립 서버라 인증서가 필요하면 실서버에서 SSL_CRT/SSL_KEY 로 지정하거나 별도 배치.)
cp -a "${ROOT}/scripts/deploy/nginx-itam.conf" "$STAGE/scripts/deploy/" 2>/dev/null || true
# ── 4. 번들 Node 동봉 ──
[[ -f "$NODE_TARBALL" ]] && cp "$NODE_TARBALL" "$STAGE/node-linux-x64.tar.xz" || echo "[WARN] 번들 Node(${NODE_TARBALL}) 없음 — 별도 동봉 필요"

# ── 4-1. 하이젠: 빌드 잔재(.env / *.db) 제거 — 실서버에 dev 시크릿·DB 유출 금지 ──
#   next build 가 .next/standalone 에 남긴 개발 .env(빌드 AUTH_SECRET·Windows 경로)와
#   *.db(빌드 중 생성된 무효 파일)를 번들에서 제거한다. 설치 시 setup.sh 가 강한 AUTH_SECRET
#   으로 .env 를 새로 만들고, DB 는 첫 기동/최소초기화로 생성된다 — 배포본엔 어느 쪽도 불필요.
find "$STAGE" -type f \( -name '.env' -o -name '.env.*' -o -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' -o -name '*.db.bak-*' \) -printf '[PURGE] %p\n' -delete

# ── 4-2. 운영 데이터 동봉 (선택, INCLUDE_DB 지정 시) ──
#   폐쇄망에 데이터가 채워진 채로 반입할 때, 지정한 SQLite 파일을 대장 DB(asset-inventory/data.db)로 탑재.
#   설치기(setup-nginx.sh)는 users>0 인 기존 DB 를 초기화하지 않으므로 그대로 보존된다.
#   미지정 시 빈 DB(설치 시 최소 초기화) — 기존 동작 유지.
if [[ -n "${INCLUDE_DB:-}" ]]; then
  [[ -f "$INCLUDE_DB" ]] || { echo "[ERROR] INCLUDE_DB 파일 없음: $INCLUDE_DB"; exit 1; }
  cp -f "$INCLUDE_DB" "$STAGE/data.db"
  echo "[OK] 운영 데이터 동봉: data.db ($(du -h "$STAGE/data.db" | cut -f1))"
fi

# ── 5. 패키징 ──
#   반입물 = tar.gz + SHA256SUMS.txt + 배포방법.txt (세 파일 모두 dist/ 에 나란히 둔다)
TARBALL="${DIST}/asset-inventory-offline.tar.gz"
tar -C "$DIST" -czf "$TARBALL" asset-inventory
( cd "$DIST" && sha256sum "$(basename "$TARBALL")" > SHA256SUMS.txt )
# 반입자가 번들을 풀기 전에도 어느 판인지 알 수 있게 안내문 맨 위에 버전을 적는다.
{ printf '[버전] v%s · 커밋 %s · 빌드 %s\n\n' "$APP_VERSION" "${APP_COMMIT:-(없음)}" "$APP_BUILT_AT"; cat "${ROOT}/scripts/deploy/배포방법.txt"; } > "${DIST}/배포방법.txt"
echo "[OK] 릴리스: ${TARBALL} ($(du -h "$TARBALL" | cut -f1)) — v${APP_VERSION} (${APP_COMMIT:-커밋 없음})"
echo "[OK] 체크섬: ${DIST}/SHA256SUMS.txt  ·  안내: ${DIST}/배포방법.txt"
echo "    적용(한 줄): sha256sum -c SHA256SUMS.txt && rm -rf asset-inventory && tar -xzf $(basename "$TARBALL") && sudo bash asset-inventory/scripts/deploy/deploy.sh"

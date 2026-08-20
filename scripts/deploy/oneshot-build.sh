#!/usr/bin/env bash
# ============================================================
# 원샷 오프라인 번들 빌드 (Rocky Linux 8.10 빌드머신, 인터넷 ON)
#   VM/빌드서버에서 딱 한 번 실행하면:
#     빌드툴 확인 → nginx RPM 8종 확보 → npm ci(소스빌드) → native 검증
#     → next build → build-release.sh → dist/asset-inventory-offline.tar.gz
#
#   사용법 (공유폴더 소스 기준):
#     bash /mnt/hgfs/asset/scripts/deploy/oneshot-build.sh
#   또는 로컬 복사본에서:
#     cd ~/asset && bash scripts/deploy/oneshot-build.sh
#
#   전제: 인터넷 ON(NAT), python3.11 / gcc-toolset-12 / Node22 설치 가능.
# ============================================================
set -euo pipefail

SRC="${SRC:-/mnt/hgfs/asset}"        # 공유폴더 소스 (없으면 스크립트 위치 기준)
WORK="${WORK:-$HOME/asset}"          # 로컬 작업 디렉터리 (ext4 — symlink 가능)
NODE_VER="${NODE_VER:-22.11.0}"
NODE_DIR="$HOME/node22"

log(){ echo -e "\n\033[1;36m== $* ==\033[0m"; }
die(){ echo -e "\033[1;31m[중단] $*\033[0m" >&2; exit 1; }

# 스크립트가 공유폴더에서 실행되면 SRC 를 그 위치로 보정
_here="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$_here/package.json" ] && SRC="$_here"

log "0) 빌드 도구 확인/설치 (인터넷 ON)"
ping -c1 -W3 mirror.rockylinux.org >/dev/null 2>&1 || die "인터넷 필요 — VM 네트워크를 NAT 로 전환 후 재실행"
command -v gcc >/dev/null || sudo dnf groupinstall -y "Development Tools"
rpm -q python3.11 >/dev/null 2>&1 || sudo dnf install -y python3.11
ls /opt/rh/gcc-toolset-12 >/dev/null 2>&1 || sudo dnf install -y gcc-toolset-12
sudo dnf install -y 'dnf-command(download)' >/dev/null 2>&1 || true

# gcc-toolset-12 활성화 (c++20) + python3.11 (node-gyp)
set +u; source scl_source enable gcc-toolset-12; set -u   # scl_source 는 _recursion 미정의 참조 → set -u 잠시 해제
export npm_config_python=/usr/bin/python3.11
export npm_config_build_from_source=true

# Node 22
if [ ! -x "$NODE_DIR/bin/node" ]; then
  log "0-1) Node ${NODE_VER} 확보"
  cd /tmp
  [ -f "node-v${NODE_VER}-linux-x64.tar.xz" ] || curl -fL -O "https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-x64.tar.xz"
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xf "node-v${NODE_VER}-linux-x64.tar.xz" -C "$NODE_DIR" --strip-components=1
fi
export PATH="$NODE_DIR/bin:$PATH"
echo "  node=$(node -v)  g++=$(g++ --version | head -1)  python=$(python3.11 --version)"
node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<6)) throw new Error('Node 22.6+ 필요')"

log "1) 소스 로컬 복사 (공유폴더 symlink 회피) → $WORK"
[ -f "$SRC/package.json" ] || die "소스 없음: $SRC (SRC=... 로 지정)"
rm -rf "$WORK" && cp -a "$SRC" "$WORK" && cd "$WORK"

log "2) nginx RPM 8종 오프라인 확보 → vendor/rpms"
mkdir -p vendor/rpms
dnf clean expire-cache >/dev/null 2>&1 || true
# el8 nginx 는 modular — 본체+모듈+filesystem 을 명시해 8종을 강제 확보
NGX_PKGS=(nginx nginx-all-modules nginx-filesystem nginx-mod-http-image-filter \
          nginx-mod-http-perl nginx-mod-http-xslt-filter nginx-mod-mail nginx-mod-stream)
dnf download --resolve --destdir vendor/rpms "${NGX_PKGS[@]}" 2>/dev/null \
  || dnf download --destdir vendor/rpms "${NGX_PKGS[@]}"
RPM_CNT=$(ls vendor/rpms/*.rpm 2>/dev/null | wc -l)
echo "  vendor/rpms: ${RPM_CNT}개"
[ "$RPM_CNT" -ge 8 ] || die "nginx RPM ${RPM_CNT}개(8 미만) — module 저장소 활성 확인: 'dnf module enable nginx'"

log "3) 번들 Node tar 배치"
cp -f "/tmp/node-v${NODE_VER}-linux-x64.tar.xz" vendor/node-linux-x64.tar.xz

log "4) npm ci (better-sqlite3 소스빌드, glibc 2.28 링크)"
rm -rf node_modules
npm ci --no-audit --no-fund --build-from-source

log "5) native smoke + glibc 심볼 검증"
node -e "require('better-sqlite3')('/tmp/_t.db').prepare('select 1 as a').get(); console.log('  native OK')"
MAXG=$(objdump -T node_modules/better-sqlite3/build/Release/better_sqlite3.node 2>/dev/null \
        | grep -oE 'GLIBC_[0-9.]+' | sort -V | tail -1)
echo "  최고 glibc 심볼: ${MAXG:-?}"
case "$MAXG" in
  GLIBC_2.2.5|GLIBC_2.1*|GLIBC_2.2[0-8]|GLIBC_2.28) : ;;
  *) die "glibc ${MAXG} > 2.28 — Rocky 8.10 서버에서 로드 실패. gcc-toolset/glibc 확인" ;;
esac

log "6) next build + 오프라인 번들 생성"
npm run build
bash scripts/deploy/build-release.sh

log "완료"
TARBALL="$WORK/dist/asset-inventory-offline.tar.gz"
[ -f "$TARBALL" ] || die "번들 생성 실패"
ls -lh "$TARBALL"
echo "  번들 내용 점검:"
tar -tzf "$TARBALL" | grep -cE 'rpms/.*\.rpm' | xargs echo "   - RPM:"
tar -tzf "$TARBALL" | grep -cE 'ssl/.*\.pem' | xargs echo "   - 인증서 PEM:"
tar -tzf "$TARBALL" | grep -q 'node-linux-x64.tar.xz' && echo "   - 번들 Node: OK" || echo "   - 번들 Node: 없음(경고)"
tar -tzf "$TARBALL" | grep -q 'standalone/node_modules/better-sqlite3' && echo "   - native: OK" || echo "   - native: 없음(경고)"
echo
echo "다음: 이 tar.gz 를 폐쇄망 서버로 옮겨 →"
echo "  tar -xzf asset-inventory-offline.tar.gz && sudo bash asset-inventory/scripts/deploy/setup-nginx.sh"

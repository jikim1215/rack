#!/bin/bash
# ============================================================
# 릴리스 빌드 스크립트 (인터넷 연결 가능한 빌드 PC에서 실행)
# 
# 이 스크립트는 빌드 PC (인터넷 가능)에서 실행하여
# 폐쇄망 서버에 전송할 릴리스 타르볼을 생성합니다.
#
# 요구사항:
#   - Node.js 20.x (Linux x86_64)
#   - 프로젝트 루트에서 실행
# ============================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_ROOT"

echo "=========================================="
echo " 릴리스 빌드 시작"
echo "=========================================="

# ── 1. 의존성 설치 ──
echo "[1/5] npm install..."
npm ci --ignore-scripts
# better-sqlite3 네이티브 빌드 (linux-x64용)
npm rebuild better-sqlite3

# ── 2. Next.js 프로덕션 빌드 ──
echo "[2/5] next build..."
npx next build

# ── 3. standalone은 사용하지 않으므로 필요 파일만 정리 ──
echo "[3/5] 릴리스 디렉터리 구성..."
RELEASE_DIR="${PROJECT_ROOT}/release"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# 필수 파일 복사
cp -r .next          "$RELEASE_DIR/"
cp -r node_modules   "$RELEASE_DIR/"
cp -r public         "$RELEASE_DIR/" 2>/dev/null || mkdir -p "$RELEASE_DIR/public"
cp -r scripts        "$RELEASE_DIR/"
cp    package.json   "$RELEASE_DIR/"
cp    next.config.ts "$RELEASE_DIR/"
cp    tsconfig.json  "$RELEASE_DIR/"
cp    postcss.config.mjs "$RELEASE_DIR/"

# src는 런타임에 필요하지 않지만, next start에서 참조할 수 있으므로 포함
cp -r src "$RELEASE_DIR/"

# ── 4. 불필요 파일 제거 ──
echo "[4/5] 불필요 파일 정리..."
# devDependencies의 대용량 파일은 유지 (next start에 필요)
# .git, .env는 제외
rm -rf "$RELEASE_DIR/.git"
rm -f  "$RELEASE_DIR/.env"

# ── 5. 타르볼 생성 ──
echo "[5/5] 타르볼 생성..."
cd "$PROJECT_ROOT"
tar -czf rack-release.tar.gz -C release .

RELEASE_SIZE=$(du -sh rack-release.tar.gz | cut -f1)
echo ""
echo "=========================================="
echo " 빌드 완료!"
echo "=========================================="
echo ""
echo " 릴리스 파일: ${PROJECT_ROOT}/rack-release.tar.gz (${RELEASE_SIZE})"
echo ""
echo " 폐쇄망 서버에 전송할 파일 목록:"
echo "   1. rack-release.tar.gz"
echo "   2. node-v20.18.1-linux-x64.tar.xz"
echo "      (https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz)"
echo "   3. scripts/deploy/install.sh"
echo ""
echo " 전송 방법: USB, SCP, 망연계 시스템 등"
echo "=========================================="

# 정리
rm -rf "$RELEASE_DIR"

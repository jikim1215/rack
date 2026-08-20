# ============================================================
# 릴리스 빌드 스크립트 (Windows 빌드 PC용)
#
# 주의: Windows에서 빌드하면 better-sqlite3의 네이티브 바인딩이
# win32-x64용으로 빌드됩니다. 폐쇄망 서버가 Linux이므로
# 두 가지 방법 중 하나를 선택하세요:
#
# [방법 1] Windows에서 빌드 + Linux에서 rebuild (권장)
#   - 이 스크립트로 빌드 후 타르볼 전송
#   - Linux 서버에서 install.sh가 자동으로 better-sqlite3 재빌드
#   - 서버에 gcc, make, python3 필요
#
# [방법 2] 동일 아키텍처 Linux에서 빌드
#   - WSL2 또는 VM에서 build-release.sh 실행
#   - 네이티브 바인딩이 linux-x64용으로 빌드됨
#   - 서버에 빌드 도구 불필요
# ============================================================

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
Set-Location $ProjectRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " 릴리스 빌드 시작 (Windows)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. 의존성 설치
Write-Host "[1/5] npm install..." -ForegroundColor Yellow
npm ci

# 2. Next.js 프로덕션 빌드
Write-Host "[2/5] next build..." -ForegroundColor Yellow
npx next build

# 3. 릴리스 디렉터리 구성
Write-Host "[3/5] 릴리스 디렉터리 구성..." -ForegroundColor Yellow
$ReleaseDir = Join-Path $ProjectRoot "release"
if (Test-Path $ReleaseDir) { Remove-Item -Recurse -Force $ReleaseDir }
New-Item -ItemType Directory -Path $ReleaseDir | Out-Null

# 필수 파일 복사
$items = @(".next", "node_modules", "scripts", "src", "package.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs")
foreach ($item in $items) {
    $src = Join-Path $ProjectRoot $item
    $dst = Join-Path $ReleaseDir $item
    if (Test-Path $src) {
        if ((Get-Item $src).PSIsContainer) {
            Copy-Item -Recurse -Force $src $dst
        } else {
            Copy-Item -Force $src $dst
        }
    }
}
# public 폴더
$publicSrc = Join-Path $ProjectRoot "public"
$publicDst = Join-Path $ReleaseDir "public"
if (Test-Path $publicSrc) {
    Copy-Item -Recurse -Force $publicSrc $publicDst
} else {
    New-Item -ItemType Directory -Path $publicDst | Out-Null
}

# 4. 불필요 파일 제거
Write-Host "[4/5] 불필요 파일 정리..." -ForegroundColor Yellow
$gitDir = Join-Path $ReleaseDir ".git"
$envFile = Join-Path $ReleaseDir ".env"
if (Test-Path $gitDir) { Remove-Item -Recurse -Force $gitDir }
if (Test-Path $envFile) { Remove-Item -Force $envFile }

# 5. 타르볼 생성
Write-Host "[5/5] 타르볼 생성..." -ForegroundColor Yellow
$tarFile = Join-Path $ProjectRoot "rack-release.tar.gz"
if (Test-Path $tarFile) { Remove-Item -Force $tarFile }
tar -czf $tarFile -C $ReleaseDir .

$size = [math]::Round((Get-Item $tarFile).Length / 1MB, 1)

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host " 빌드 완료!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host " 릴리스 파일: rack-release.tar.gz (${size}MB)"
Write-Host ""
Write-Host " 폐쇄망 서버에 전송할 파일:" -ForegroundColor Yellow
Write-Host "   1. rack-release.tar.gz"
Write-Host "   2. node-v20.18.1-linux-x64.tar.xz"
Write-Host "      (https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz)"
Write-Host "   3. scripts/deploy/install.sh"
Write-Host ""
Write-Host " ⚠ Windows 빌드의 경우 서버에 빌드 도구 필요:" -ForegroundColor Red
Write-Host "   dnf groupinstall 'Development Tools'"
Write-Host "   dnf install python3"
Write-Host "   install.sh가 자동으로 better-sqlite3를 재빌드합니다"
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green

# 정리
Remove-Item -Recurse -Force $ReleaseDir

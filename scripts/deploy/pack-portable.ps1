# ============================================================
# 포터블 패키지 생성 (Windows에서 실행)
#
# 결과물: rack-portable.tar.gz
# 폐쇄망 Rocky Linux 8.10 서버에서 압축 풀고 start.sh로 바로 실행
# ============================================================

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
Set-Location $ProjectRoot

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " 포터블 패키지 생성" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# ── 1. 빌드 확인 ──
$standalone = Join-Path $ProjectRoot ".next\standalone"
if (-not (Test-Path "$standalone\server.js")) {
    Write-Host "[ERROR] standalone 빌드가 없습니다. 먼저 'npx next build'를 실행하세요." -ForegroundColor Red
    exit 1
}

# ── 2. prebuilt 바이너리 확인 ──
$prebuilt = Join-Path $ProjectRoot "better-sqlite3-linux.tar.gz"
if (-not (Test-Path $prebuilt)) {
    Write-Host "[ERROR] better-sqlite3 Linux 바이너리가 없습니다." -ForegroundColor Red
    Write-Host "        다운로드: https://github.com/WiseLibs/better-sqlite3/releases" -ForegroundColor Yellow
    exit 1
}

$nodeTar = Join-Path $ProjectRoot "node-v20.18.1-linux-x64.tar.xz"
if (-not (Test-Path $nodeTar)) {
    Write-Host "[ERROR] Node.js Linux 바이너리가 없습니다." -ForegroundColor Red
    Write-Host "        다운로드: https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz" -ForegroundColor Yellow
    exit 1
}

# ── 3. 포터블 디렉터리 구성 ──
Write-Host "[1/5] 포터블 디렉터리 구성..." -ForegroundColor Yellow
$portDir = Join-Path $ProjectRoot "rack-portable"
if (Test-Path $portDir) { Remove-Item -Recurse -Force $portDir }
New-Item -ItemType Directory -Path $portDir | Out-Null

# standalone 복사
$appDir = Join-Path $portDir "app"
Copy-Item -Recurse -Force $standalone $appDir

# .next/static 복사 (standalone에 빠져있음)
$staticSrc = Join-Path $ProjectRoot ".next\static"
$staticDst = Join-Path $appDir ".next\static"
if (Test-Path $staticSrc) {
    Copy-Item -Recurse -Force $staticSrc $staticDst
}

# public 복사
$publicSrc = Join-Path $ProjectRoot "public"
$publicDst = Join-Path $appDir "public"
if (Test-Path $publicSrc) {
    Copy-Item -Recurse -Force $publicSrc $publicDst
} else {
    New-Item -ItemType Directory -Path $publicDst | Out-Null
}

# scripts 복사 (db-seed)
$scriptsDst = Join-Path $appDir "scripts"
New-Item -ItemType Directory -Path $scriptsDst -Force | Out-Null
Copy-Item -Force (Join-Path $ProjectRoot "scripts\db-seed.mjs") $scriptsDst

# ── 4. better-sqlite3 Linux 바이너리 교체 ──
Write-Host "[2/5] better-sqlite3 Linux 바이너리 적용..." -ForegroundColor Yellow
$bsqlBuildDir = Join-Path $appDir "node_modules\better-sqlite3\build\Release"
if (-not (Test-Path $bsqlBuildDir)) {
    New-Item -ItemType Directory -Path $bsqlBuildDir -Force | Out-Null
}
tar -xzf $prebuilt -C (Join-Path $appDir "node_modules\better-sqlite3")

# ── 5. Node.js 바이너리 복사 ──
Write-Host "[3/5] Node.js 바이너리 포함..." -ForegroundColor Yellow
Copy-Item -Force $nodeTar $portDir

# ── 6. 시작/중지 스크립트 생성 ──
Write-Host "[4/5] 실행 스크립트 생성..." -ForegroundColor Yellow

# .env 제거 (서버에서 생성)
$envFile = Join-Path $appDir ".env"
if (Test-Path $envFile) { Remove-Item -Force $envFile }

# data.db 제거 (서버에서 생성)
$dbFile = Join-Path $appDir "data.db"
if (Test-Path $dbFile) { Remove-Item -Force $dbFile }

# setup.sh, backup.sh, restore.sh 복사
Copy-Item -Force (Join-Path $ProjectRoot "scripts\deploy\setup.sh") $portDir
Copy-Item -Force (Join-Path $ProjectRoot "scripts\deploy\backup.sh") $portDir
Copy-Item -Force (Join-Path $ProjectRoot "scripts\deploy\restore.sh") $portDir

# ── 7. 타르볼 생성 ──
Write-Host "[5/5] 타르볼 생성..." -ForegroundColor Yellow
$tarFile = Join-Path $ProjectRoot "rack-portable.tar.gz"
if (Test-Path $tarFile) { Remove-Item -Force $tarFile }
tar -czf $tarFile -C $ProjectRoot rack-portable

$size = [math]::Round((Get-Item $tarFile).Length / 1MB, 1)

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host " 패키지 생성 완료!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host " 파일: rack-portable.tar.gz (${size}MB)" -ForegroundColor White
Write-Host ""
Write-Host " 서버에서:" -ForegroundColor Yellow
Write-Host "   1. tar -xzf rack-portable.tar.gz" -ForegroundColor White
Write-Host "   2. cd rack-portable" -ForegroundColor White
Write-Host "   3. sudo bash setup.sh" -ForegroundColor White
Write-Host "==========================================" -ForegroundColor Green

# 정리
Remove-Item -Recurse -Force $portDir

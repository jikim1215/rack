# 폐쇄망 배포 가이드

대상 환경: **Rocky Linux 8.10** (Intel x86_64, 폐쇄망/인터넷 차단)

---

## 전체 절차 요약

```
[인터넷 PC]                    [USB/망연계]              [폐쇄망 서버]
빌드 + 패키징  ──────────────▶  파일 전송  ──────────────▶  설치 + 실행
```

---

## 1단계: 빌드 PC에서 릴리스 패키징 (인터넷 필요)

### 필요 파일 3개 준비

| 파일 | 설명 | 비고 |
|------|------|------|
| `rack-release.tar.gz` | 앱 빌드 결과물 | 빌드 스크립트로 생성 |
| `node-v20.18.1-linux-x64.tar.xz` | Node.js 런타임 | [공식 다운로드](https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz) |
| `scripts/deploy/install.sh` | 설치 스크립트 | 프로젝트에 포함 |

### 빌드 방법

**방법 A: Linux/WSL2에서 빌드 (권장)**

```bash
cd /path/to/rack
bash scripts/deploy/build-release.sh
```

- better-sqlite3가 linux-x64용으로 빌드됨
- 서버에 빌드 도구 불필요

**방법 B: Windows에서 빌드**

```powershell
cd D:\gajea\rack
powershell -ExecutionPolicy Bypass -File scripts/deploy/build-release.ps1
```

- better-sqlite3가 win32-x64용으로 빌드됨
- 서버에서 install.sh가 자동 재빌드 (서버에 gcc/make/python3 필요)
- 서버에 인터넷 없이 `npm rebuild`를 하려면 빌드 도구가 사전 설치되어 있어야 함

### Node.js 바이너리 다운로드

```
https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz
```

---

## 2단계: 파일 전송

USB, CD, 망연계 시스템 등으로 3개 파일을 폐쇄망 서버에 전송.

```
/tmp/rack-deploy/
├── rack-release.tar.gz
├── node-v20.18.1-linux-x64.tar.xz
└── install.sh
```

---

## 3단계: 서버 설치

```bash
cd /tmp/rack-deploy
sudo bash install.sh
```

### install.sh가 하는 일

1. Node.js 20.x 설치 (`/usr/local/`)
2. 서비스 계정 `rackapp` 생성
3. `/opt/rack-asset-manager/`에 앱 배포
4. better-sqlite3 네이티브 바인딩 검증 (필요 시 재빌드)
5. `.env` 생성 (랜덤 AUTH_SECRET)
6. DB 초기화 + 시드 데이터
7. 파일 권한 설정 (600)
8. systemd 서비스 등록 + 시작
9. 방화벽 포트 3000 개방
10. SELinux 정책 설정

### 설치 후 확인

```bash
# 서비스 상태
systemctl status rack-asset-manager

# 로그
journalctl -u rack-asset-manager -f

# 접속
curl http://localhost:3000
```

---

## 4단계: 접속 및 초기 설정

| 항목 | 값 |
|------|-----|
| URL | `http://<서버IP>:3000` |
| 관리자 계정 | `admin` / `admin123!` |

**첫 로그인 후 반드시:**
1. 관리자 비밀번호 변경 (설정 > 비밀번호 변경)
2. 사용자 계정 생성 (설정 > 사용자 관리)
3. 메뉴 권한 설정 (설정 > 권한 관리)

---

## 운영

### DB 백업 (일일)

```bash
# 수동 백업
sudo bash /opt/rack-asset-manager/scripts/deploy/backup.sh

# cron 자동 백업 (매일 02:00)
echo "0 2 * * * root /opt/rack-asset-manager/scripts/deploy/backup.sh" \
  >> /etc/cron.d/rack-backup
```

### DB 복원

```bash
# 백업 목록 확인
ls /opt/rack-asset-manager/backups/

# 복원
sudo bash /opt/rack-asset-manager/scripts/deploy/restore.sh \
  /opt/rack-asset-manager/backups/data.db.20260619_020000.gz
```

### 업데이트

1. 빌드 PC에서 새 `rack-release.tar.gz` 생성
2. 서버에 전송
3. `sudo bash install.sh` 재실행 (DB는 자동 보존)

### 서비스 관리

```bash
systemctl status rack-asset-manager    # 상태
systemctl restart rack-asset-manager   # 재시작
systemctl stop rack-asset-manager      # 중지
journalctl -u rack-asset-manager -f    # 실시간 로그
```

### 포트 변경

```bash
# /opt/rack-asset-manager/.env 수정
PORT=8080

# systemd 서비스 파일 수정
vi /etc/systemd/system/rack-asset-manager.service
# ExecStart 줄의 -p 값 변경

# 방화벽 + 재시작
firewall-cmd --permanent --add-port=8080/tcp
firewall-cmd --reload
systemctl daemon-reload
systemctl restart rack-asset-manager
```

---

## 사전 요구사항

### 서버 최소 사양

| 항목 | 최소 | 권장 |
|------|------|------|
| CPU | 2코어 | 4코어 |
| RAM | 2GB | 4GB |
| 디스크 | 10GB | 50GB |
| OS | Rocky Linux 8.x | Rocky Linux 8.10 |

### Windows 빌드 후 서버 추가 요구사항

better-sqlite3 재빌드를 위해:

```bash
dnf groupinstall -y "Development Tools"
dnf install -y python3
```

> Linux에서 빌드하면 이 요구사항은 필요 없음

---

## 문제 해결

### better-sqlite3 로딩 오류

```
Error: Cannot find module '../build/Release/better_sqlite3.node'
```

→ 네이티브 바인딩이 현재 OS에 맞지 않음. 재빌드:

```bash
cd /opt/rack-asset-manager
npm rebuild better-sqlite3
systemctl restart rack-asset-manager
```

### 포트 접속 불가

```bash
# 방화벽 확인
firewall-cmd --list-ports

# SELinux 확인
getenforce
# Enforcing이면:
setsebool -P httpd_can_network_connect 1
```

### 권한 오류

```bash
chown -R rackapp:rackapp /opt/rack-asset-manager
chmod 600 /opt/rack-asset-manager/.env
chmod 600 /opt/rack-asset-manager/data.db
```

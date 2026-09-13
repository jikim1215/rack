# 폐쇄망 설치 안내 (Rocky Linux 8.10 · nginx + 정식 SSL)

대상: **itam.example.go.kr** 정보시스템 자산관리 — 인터넷 차단 단일 서버.
구성: **nginx(443 TLS 종단) → 내부 Next standalone(127.0.0.1:3000)**, 정식 KISA 인증서 적용.

```
[빌드 PC: Windows + WSL2(Rocky 8)]        [USB/망연계]        [운영: 폐쇄망 Rocky 8.10]
  오프라인 번들 생성          ───────────▶  파일 전송  ───────────▶  단일 명령 설치
```

---

## 1단계: 빌드 (WSL2 Rocky 8 — 인터넷 필요, 1회)

better-sqlite3는 **네이티브 모듈**이라 타깃과 동일 OS(glibc 2.28)에서 빌드해야 합니다. Windows에서 만든 바이너리는 Rocky에서 동작하지 않으므로 **WSL2의 Rocky 8**에서 빌드합니다.

```bash
# (WSL2 Rocky 8 안에서, 저장소 루트에서)
# 사전 1회: nginx 등 오프라인 RPM 확보 (인터넷 되는 시점)
dnf download --resolve --destdir vendor/rpms nginx
# 번들 Node(22.6+) 확보: vendor/node-linux-x64.tar.xz

# 오프라인 번들 생성 (앱 + native + nginx RPM + 정식 SSL + 배포 스크립트)
bash scripts/deploy/build-release.sh
# 산출물: dist/asset-inventory-offline.tar.gz
```

번들에 포함되는 것:
- `.next/standalone` (Next 독립 실행) + static/public
- `node_modules/better-sqlite3` prebuilt(linux-x64) + Plan B(소스 리빌드)
- 번들 Node(`node-linux-x64.tar.xz`)
- `rpms/` (nginx 등 오프라인 RPM)
- `ssl/` (정식 인증서 PEM 3종: cert / DigiCertCA / newkey)
- `scripts/deploy/` (setup-nginx.sh, nginx-itam.conf, backup/restore, native-planb …)

> ⚠️ `ssl/` 인증서와 `vendor/rpms/nginx-*.rpm` 이 없으면 각각 자체서명 폴백 / nginx 오프라인 설치 실패 경고가 납니다. 정식 운영엔 둘 다 필요.

---

## 2단계: 전송

`dist/asset-inventory-offline.tar.gz` 를 USB/망연계로 운영 서버 `/tmp` 등에 전송.

---

## 3단계: 설치 (운영 서버, 무인터넷)

```bash
tar -xzf asset-inventory-offline.tar.gz
sudo bash asset-inventory/scripts/deploy/setup-nginx.sh
```

`setup-nginx.sh` 동작(단일 명령):
1. `/opt/asset-inventory` 배치 + 번들 Node + `asset` 서비스 계정
2. better-sqlite3 native smoke (실패 시 Plan B 소스 리빌드)
3. `.env` 생성 (`AUTH_SECRET` 랜덤, `COOKIE_SECURE=true`, `PUBLIC_FQDN=itam.example.go.kr`, 내부 127.0.0.1:3000)
4. systemd `asset-inventory.service` (내부 HTTP) + 백업/보존 타이머
5. **nginx 설치 + 정식 인증서 fullchain 자동 구성 + 443/80 + SELinux + 방화벽**
6. IP 자동 감지, HTTPS 헬스체크

비대화형/자동:
```bash
sudo SERVER_IP=10.0.0.5 PUBLIC_FQDN=itam.example.go.kr bash asset-inventory/scripts/deploy/setup-nginx.sh
```

---

## 4단계: 접속 · 초기 설정

| 항목 | 값 |
|------|----|
| URL | `https://itam.example.go.kr/` (내부 DNS 등록 필요) 또는 `https://<서버IP>/` |
| 관리자 | `admin@example.go.kr` / `admin123` |

**내부 DNS**: 기관 DNS에 `itam.example.go.kr → 서버IP` A레코드 등록. 임시로는 클라이언트 `hosts` 에 `서버IP itam.example.go.kr`.

**첫 로그인 후 필수**: ① admin 비밀번호 변경 ② 사용자 계정 생성 ③ 메뉴 권한 설정.

---

## 5단계: 데이터 이관

로그인 후 화면 업로드 또는 이관 스크립트. DB 경로는 `.env` `ASSET_DB_PATH=/opt/asset-inventory/data.db` 로 일관되게. 상세는 `docs/운영매뉴얼.md §7`.

---

## 서버 최소 사양

| 항목 | 최소 | 권장 |
|------|------|------|
| CPU | 2코어 | 4코어 |
| RAM | 2GB | 4GB |
| 디스크 | 10GB | 50GB |
| OS | Rocky Linux 8.x | Rocky Linux 8.10 |

## 인증서 정보 (현재 번들)

- 주체: `CN=*.example.go.kr` (SAN: `*.example.go.kr`, `example.go.kr`) → **itam.example.go.kr 커버**
- 발급자: DigiCert/GeoTrust, 유효기간 약 6개월 → **반기 갱신 필수** (`docs/운영매뉴얼.md §4.3`)

문제 발생 시 → `docs/운영매뉴얼.md §8 긴급 대응`.

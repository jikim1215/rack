# VMware Rocky 8.10 배포 리허설 절차

목적: 폐쇄망 실서버 반입 전에 VMware Rocky Linux 8.10 VM에서 **빌드 → 폐쇄망 전환 → 설치 → 검증**을 그대로 재현한다.
전제: VM 스냅샷 완료(실패 시 롤백). 빌드 단계만 인터넷 연결(NAT), 설치는 폐쇄망(host-only)으로 전환.

소스 반입: `.` → VMware **공유폴더**로 마운트(예: `/mnt/hgfs/asset`). 아래는 그 경로를 `SRC` 로 참조.

```bash
SRC=/mnt/hgfs/asset        # 공유폴더 실제 경로로 교체
sudo dnf install -y open-vm-tools   # 공유폴더/툴 (인터넷 ON 단계에서)
```

---

## 0단계. VM 네트워크: 인터넷 ON (NAT)

VMware > VM 설정 > Network Adapter > **NAT** 로 두고 부팅. 확인:
```bash
ping -c1 mirror.rockylinux.org && echo "인터넷 OK"
node -v 2>/dev/null; nginx -v 2>/dev/null   # 없으면 아래에서 설치/확보
```

---

## 1단계. 빌드 도구 + 런타임 확보 (인터넷 ON)

```bash
# 빌드 도구 (better-sqlite3 소스 컴파일용)
#   ⚠️ Rocky 8 기본 python3(3.6)·gcc(8.5)로는 실패한다:
#     - node-gyp gyp가 walrus(:=, 3.8+) 사용 → python3.11 필요
#     - better-sqlite3가 -std=c++20 요구 → gcc-toolset-12(GCC 12) 필요
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y git python3.11 gcc-toolset-12
source scl_source enable gcc-toolset-12        # 최신 gcc/g++ 활성화 (c++20)
export npm_config_python=/usr/bin/python3.11   # node-gyp가 3.11 사용
g++ --version | head -1                         # 12.x 확인

# Node 22.6+ (빌드/런타임). nvm 없이 공식 tar 사용 권장.
cd /tmp
curl -fL -O https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz
mkdir -p ~/node22 && tar -xf node-v22.11.0-linux-x64.tar.xz -C ~/node22 --strip-components=1
export PATH="$HOME/node22/bin:$PATH"
node -v   # v22.11.0 기대

# 저장소로 이동 — 공유폴더는 심볼릭/권한 이슈가 있으니 로컬로 복사해 작업
cp -a "$SRC" ~/asset && cd ~/asset

# 번들 Node tar 를 vendor/ 에 배치 (build-release 가 동봉)
cp /tmp/node-v22.11.0-linux-x64.tar.xz vendor/node-linux-x64.tar.xz

# nginx + 런타임 RPM 오프라인 확보 (의존성까지 resolve)
mkdir -p vendor/rpms
sudo dnf install -y 'dnf-command(download)'
dnf download --resolve --destdir vendor/rpms nginx
ls vendor/rpms/    # nginx-*.rpm 등 존재 확인
```

---

## 2단계. 오프라인 번들 빌드 (인터넷 ON)

```bash
cd ~/asset
export PATH="$HOME/node22/bin:$PATH"
npm ci --no-audit --no-fund
bash scripts/deploy/build-release.sh
# 산출물: dist/asset-inventory-offline.tar.gz
ls -lh dist/asset-inventory-offline.tar.gz
# 로그에 아래가 모두 [OK] 인지 확인:
#  - standalone native 동봉 / prebuilt native 동봉
#  - nginx/런타임 RPM 동봉 / 정식 SSL 인증서 동봉
```

> `build-release.sh` 는 `glibc != 2.28` 이면 중단한다. Rocky 8.10이면 통과. (검증만 우회: `ALLOW_GLIBC_MISMATCH=1`)

---

## 3단계. 폐쇄망 전환 (인터넷 OFF)

VMware > VM 설정 > Network Adapter > **Host-only** 로 변경(또는 케이블 연결 해제). 확인:
```bash
ping -c1 8.8.8.8 || echo "폐쇄망 전환 완료(인터넷 차단됨)"
ip -4 addr show | grep inet   # VM IP 확인 (설치 후 접속용)
```

---

## 4단계. 오프라인 설치 (폐쇄망)

```bash
cd /tmp
cp ~/asset/dist/asset-inventory-offline.tar.gz .
tar -xzf asset-inventory-offline.tar.gz
sudo bash asset-inventory/scripts/deploy/setup-nginx.sh
# 또는 비대화형:
# sudo PUBLIC_FQDN=itam.example.go.kr bash asset-inventory/scripts/deploy/setup-nginx.sh
```

설치 로그 기대치:
- `[OK] better-sqlite3 native smoke 통과`
- 내부 앱 `http://127.0.0.1:3000/login → 200`
- `[인증서] fullchain 적용: leaf=cert.pem 중간CA=DigiCertCA.pem`
- `-> https://<IP>/login → 200`

---

## 5단계. 검증 (폐쇄망)

```bash
# 서비스
systemctl status asset-inventory nginx --no-pager | head
ss -tlnp | grep -E ':3000|:443|:80'

# 헬스체크
curl -s  -o /dev/null -w "app  : %{http_code}\n" http://127.0.0.1:3000/login
curl -sk -o /dev/null -w "https: %{http_code}\n" https://127.0.0.1/login
curl -sk -o /dev/null -w "http→ : %{http_code}\n" http://127.0.0.1/login     # 301 기대

# 인증서 서빙 확인 (도메인 SNI)
echo | openssl s_client -connect 127.0.0.1:443 -servername itam.example.go.kr 2>/dev/null | openssl x509 -noout -subject -enddate

# 실제 로그인 (프리해시 필요 — 브라우저는 자동)
PH=$(node -e "console.log(require('crypto').createHash('sha512').update('admin123').digest('hex'))")
curl -sk -c /tmp/cj.txt -X POST https://127.0.0.1/api/auth/login \
  -H 'Content-Type: application/json' -d "{\"username\":\"admin@example.go.kr\",\"password\":\"$PH\"}" -w '\n%{http_code}\n'
# 200 + Set-Cookie 기대
```

**브라우저 검증(윈도우 호스트)**: `hosts` 에 `<VM IP> itam.example.go.kr` 추가 → `https://itam.example.go.kr/` 접속.
- 정식 인증서라 **경고 없이** 열려야 정상(사설 DNS면 `*.example.go.kr` 도메인 일치).
- 로그인 admin@example.go.kr / admin123 → 대시보드 → 유지보수 2탭·유지관리 대상·반입/반출 물리정보 확인.

---

## 문제 시
- 502: `sudo setsebool -P httpd_can_network_connect 1` 후 `systemctl restart nginx`
- native 오류: `sudo bash /opt/asset-inventory/scripts/deploy/native-planb.sh`
- 로그인 500: `.env` 의 `AUTH_SECRET` 존재 확인
- 상세: `docs/운영매뉴얼.md §8`

리허설 성공 후 동일 `asset-inventory-offline.tar.gz` 를 실 폐쇄망 서버에 반입 → 4단계만 반복.

---

## 검증 완료 기록 (2026-07-10, VMware Rocky 8.10 / Enforcing / 폐쇄망)

전 구간 실동작 검증됨. 리허설이 잡아낸 실전 이슈 5개(모두 스크립트에 반영):

| # | 증상 | 원인 | 해결 |
|---|------|------|------|
| 1 | node-gyp `SyntaxError: invalid syntax` | 기본 python3=3.6 (walrus 미지원) | `python3.11` + `npm_config_python` |
| 2 | `unrecognized option -std=c++20` | 기본 gcc=8.5 | `gcc-toolset-12` (`scl_source enable`) |
| 3 | nginx 설치 시 의존 누락 | 단일 RPM만 설치 | `rpms/*.rpm` 전체 dnf 로컬 설치 |
| 4 | `.env` `Permission denied` → 기동 실패 | 홈 빌드 tar → `user_home_t` 라벨 | `restorecon -R $APP_DIR` (+`.env` etc_t) |
| 5 | http2 unknown / http→404 | nginx 1.14 신문법·기본 default_server 충돌 | `listen 443 ssl http2;` + 기본 default_server 토큰 제거 |
| 6 | 접속 시 `localhost:3000` 으로 튕김(외부 접속 불가) | middleware `new URL('/login', request.url)` 가 내부 바인딩 host 노출 | `X-Forwarded-Host`/`Proto` 로 외부 오리진 절대 URL 재구성 (앱 재빌드 필요). ※ 상대경로 Location 은 미들웨어 `ERR_INVALID_URL`(500) 유발하므로 금지 |
| 7 | 로그인 "등록된 사용자가 없습니다"(503) | 반입 번들에 data.db 없음(gitignore) → 빈 DB | 설치 시 `SEED_MINIMAL=1` 로 스키마+계정+권한 자동 초기화. standalone 의 better-sqlite3(bindings 완비)로 실행 |

최종 헬스체크: `app:200` / `https:200` / `http→301` / 인증서 `CN=*.example.go.kr` (~2026-09-25).
로그인 E2E(외부 브라우저 경로): `/login 200` · `POST /api/auth/login 200(admin)` · 세션쿠키 SET · `/(대시보드) 200` · `/api/maintenance 200`.

> 이슈 1·2·6 은 빌드 단계(빌드머신)에서, 3·4·5 는 설치 단계에서 처리된다.
> 6(middleware)은 앱 소스 수정이라 이미 코드에 반영됨 — 새로 빌드한 번들에 포함된다.
> 실서버는 이 번들을 반입해 `setup-nginx.sh` 한 번이면 3·4·5 가 자동 처리된다.

---

## share.example.go.kr 공존 검증 (같은 서버, 2026-07-15)

한 서버·한 nginx 에서 share(공존시스템)와 itam 을 동시 서빙 검증 완료.

| 접속 (SNI) | HTTP | 실제 앱 | upstream |
|---|---|---|---|
| `itam.example.go.kr/login` | 200 | 정보시스템 자산관리 | 127.0.0.1:3100 |
| `share.example.go.kr/login` | 200 | K-Flow | 127.0.0.1:3000 |
| IP 직접 | 307 | default=share | — |

- 격리: 포트(3100/3000) + server_name(도메인 SNI) + 쿠키(asset_session vs 공존시스템) 완전 분리.
- itam 로그인 E2E: `/login 200` · `login_api 200(admin)` · 대시보드 200 · `/api/maintenance 200` — share 동시 가동 중에도 무간섭.
- conf 는 `conf.d/shared.conf`(share, server_name _) + `conf.d/itam.conf`(itam, server_name itam.example.go.kr) 공존.

> **설치 순서 주의**: 실서버는 share 가 먼저 nginx(1.30)를 설치한 상태 → itam 설치 시 `command -v nginx` 로 스킵되어 1.30 위에서 돈다(itam conf 는 `listen 443 ssl http2;` 1.14/1.30 양쪽 호환). 리허설에서는 itam 이 nginx 1.14 를 먼저 깔아 share 의 `http2 on;`(1.25+) 이 깨졌고, 1.14 호환 구문으로 임시 조정해 검증했다(실서버 불필요).
> **접속은 도메인(SNI) 필수** — IP 직접 접속은 default(share)로 간다. DNS 에 `itam.example.go.kr → 서버IP` A레코드 등록.

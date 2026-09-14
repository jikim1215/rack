# 폐쇄망 배포 (운영자 상세)

반입 담당자용 한 장 안내는 번들 안 `scripts/deploy/README-반입.md` 입니다. 이 문서는 **운영자 상세** — 빌드·옵션·환경변수·롤백·문제해결.

---

## 1. 구성

```
[사용자 PC] ──HTTPS(443)──▶ nginx (server_name itam.example.go.kr, 공존시스템 인증서 공유)
                                │ proxy_pass
                                ▼
                     Next.js standalone (127.0.0.1:3100, 번들 Node 22)
                                │
                                ▼
                     SQLite data.db (WAL) + backups/ + tls/
```

- 대상 OS: Rocky Linux 8.10 x86_64 (glibc 2.28). **빌드도 같은 OS 에서** — better-sqlite3 native ABI 일치.
- 서비스 계정 `asset`, 앱 `/opt/asset-inventory`, systemd `asset-inventory` + `asset-backup.timer` + `asset-retention.timer`.
- 인터넷 불필요: 번들에 Node 런타임·native 모듈·nginx RPM·앱·문서가 전부 들어 있다.

## 2. 빌드 (스테이징/빌드 머신, Rocky 8.10)

```bash
bash scripts/deploy/build-release.sh      # npm ci(오프라인 캐시) → next build → 스테이징 → tar
node scripts/verify-build.mjs             # 정적 프리렌더 0건 확인 (nonce CSP 양립 — 필수)
sha256sum dist/asset-inventory-offline.tar.gz > dist/SHA256SUMS.txt
```

전제: `vendor/node-linux-x64.tar.xz`(Node 22.6+), `vendor/rpms/*.rpm`(nginx 오프라인 설치용), npm 캐시에 의존성 전부. 첫 빌드는 인터넷 되는 시점에 한 번 `npm ci` 로 캐시를 채워 둔다.

## 3. 배포 — 한 줄

```bash
tar -xzf asset-inventory-offline.tar.gz
sudo bash asset-inventory/scripts/deploy/deploy.sh          # 신규/업그레이드 자동 판별
sudo bash asset-inventory/scripts/deploy/deploy.sh --check  # 변경 없이 점검만
```

| 판별 | 조건 | 하는 일 |
|---|---|---|
| **업그레이드** | `/opt/asset-inventory/data.db` 있음 | `upgrade-inplace.sh` — DB 백업 → 롤백본 보관 → 앱 트리 교체(.next/src/scripts/docs/node_modules) → 재기동 → 스모크. **data.db·.env·node/·tls/·backups/ 보존** |
| **신규설치** | 없음 | `setup-nginx.sh` — 번들 Node 전개 → 서비스 계정 → native smoke → .env 생성(강한 AUTH_SECRET) → nginx RPM 설치·사이트 설정 → systemd·타이머 등록 → 기동 |

`--check` 는 설치 상태, 수행 예정 작업, **현재 메뉴 권한이 어느 화면을 막게 되는지**(`preflight-perms.cjs`)까지 출력한다.

### 신규설치 옵션

```bash
sudo PUBLIC_FQDN=itam.example.go.kr bash …/deploy.sh
sudo SSL_CRT=/etc/ssl/certs/shared.crt SSL_KEY=/etc/ssl/private/shared.key PUBLIC_FQDN=… bash …/deploy.sh
sudo NEXT_INTERNAL_PORT=3100 bash …/deploy.sh    # 공존시스템이 3000 을 쓰므로 기본 3100
```

인증서는 번들에 넣지 않는다 — 공존시스템(share)의 정식 인증서를 nginx 가 참조한다. 갱신도 그쪽에서 한 번만.

## 4. 환경변수 (`/opt/asset-inventory/.env`)

`setup-nginx.sh` 가 만든다. 전체 목록과 설명은 저장소의 `.env.example`. 운영에서 자주 바꾸는 것:

| 키 | 기본 | 설명 |
|---|---|---|
| `SESSION_TTL_HOURS` | 8 | 세션 수명. 공용 PC 환경이면 4 |
| `MFA_REQUIRED_ROLES` | admin | 2단계 인증 등록 강제 역할. `none` 이면 전원 선택 |
| `TRUST_PROXY` | true | nginx 뒤에서 X-Forwarded-For 신뢰(허용 IP·접속기록) |
| `COOKIE_SECURE` | true | HTTPS 전용 쿠키 |
| `NOTIFICATION_CHANNELS` | inapp,email | `inapp` 만이면 메일 발송 차단 |

변경 후 `sudo systemctl restart asset-inventory`.

## 5. 첫 기동 시 자동 마이그레이션

앱이 DB 를 처음 건드리는 요청에서 `getDb()` 가 스키마를 맞춘다(수동 작업 없음): 메뉴 권한 시드(레지스트리 기본값, 유령 행 정리), 감사로그 `entity_type` 확장, `feedback` 테이블, 날짜 정규화(`user_version` 2), 2단계 인증·현행 확인 컬럼, 인덱스.

해석 불가 날짜가 있으면 로그에 남는다 — `sudo journalctl -u asset-inventory | grep MIGRATION`.

## 6. 배포 후 확인

### 6-1. 헬스체크 (무인증)

```bash
curl -s http://127.0.0.1:3100/api/health                              # 앱 직접
curl -sk -H 'Host: itam.example.go.kr' https://127.0.0.1/api/health   # nginx 경유
# → {"ok":true,"db":"ok","schema":2,"version":"1.0.0",...}
```

**`-H 'Host: ...'` 를 빼면 안 된다** — nginx 는 server_name(SNI)으로 갈라서 IP·localhost 직접 접속은 default 서버(공존시스템)로 간다.

### 6-2. 핵심 화면 불변식 (smoke)

```bash
sudo install -m 644 /opt/asset-inventory/scripts/smoke.mjs /tmp/smoke.mjs
cd /opt/asset-inventory && sudo -u asset env \
  BASE_URL=http://127.0.0.1:3100 \
  SMOKE_USER=<총괄계정ID> SMOKE_PASS='<비밀번호>' \
  SMOKE_MIN_ASSETS=100 SMOKE_MIN_SUBASSETS=100 \
  ./node/bin/node /tmp/smoke.mjs
sudo rm -f /tmp/smoke.mjs
```

주의점 3가지 — 전부 실제로 걸리는 것들이다:

| 함정 | 이유 · 대처 |
|---|---|
| `/tmp` 로 복사해서 실행 | 번들을 운영자 홈(mode 700)에 풀었으면 `asset` 계정이 경로를 탐색하지 못해 `MODULE_NOT_FOUND` 로 죽는다 |
| `BASE_URL` 명시 | 기본값은 `localhost:3000` — 이 시스템의 내부 포트는 **3100** |
| **MFA 게이트** | `MFA_REQUIRED_ROLES` 기본값이 `admin` 이라, 2단계 인증 미등록 총괄계정은 로그인은 되지만 모든 API 가 `403 MFA_SETUP_REQUIRED` 다 → smoke 가 전부 실패한다 |

MFA 게이트 해결은 **둘 중 하나** — 신규 설치 직후라면 앞쪽을 권장한다:

1. 먼저 브라우저로 총괄계정 2단계 인증을 등록(설정 → 2단계 인증)한 뒤 smoke 실행. 어차피 운영 시작 전에 해야 하는 작업이다.
2. 점검 창에서만 잠시 푸는 방법 — **끝나면 반드시 원복**:
   ```bash
   sudo cp -a /opt/asset-inventory/.env /opt/asset-inventory/.env.bak
   sudo sh -c 'echo MFA_REQUIRED_ROLES=none >> /opt/asset-inventory/.env'
   sudo systemctl restart asset-inventory && sleep 7
   # … smoke 실행 …
   sudo mv /opt/asset-inventory/.env.bak /opt/asset-inventory/.env
   sudo chown asset:asset /opt/asset-inventory/.env && sudo chmod 600 /opt/asset-inventory/.env
   sudo systemctl restart asset-inventory
   ```

`SMOKE_MIN_ASSETS`·`SMOKE_MIN_SUBASSETS` 는 배포처 규모에 맞춘다(빈 DB 로 시작했으면 `0`). 값은 '데이터가 조용히 증발하는' 회귀를 잡는 하한이다.

### 6-3. 스테이징 전용

`npm run verify:api`(인가·MFA·개선의견 E2E)는 **스테이징 전용** — 테스트 데이터를 쓰고 지운다. 실운영 DB 에 돌리지 말 것.

> `verify-mfa.mjs` 는 대상 계정의 2단계 인증을 켡0다가 **마지막에 끔다**. 중간에 실패하면 MFA 가 켜진 채로 남을 수 있으니 `scripts/deploy/disable-mfa.cjs` 로 풀 것.

## 7. 롤백

`upgrade-inplace.sh` 가 종료 시 복원 명령을 출력한다:

```bash
sudo systemctl stop asset-inventory
sudo cp -a /opt/asset-inventory.rollback-<시각>/. /opt/asset-inventory/
sudo chown -R asset:asset /opt/asset-inventory
sudo systemctl start asset-inventory
```

DB 까지 되돌려야 하면(스키마가 앞선 버전이라 구버전이 못 읽는 경우):

```bash
sudo systemctl stop asset-inventory
sudo -u asset sh -c 'gunzip -c /opt/asset-inventory/backups/data.db.preupgrade-<시각>.gz > /opt/asset-inventory/data.db'
sudo systemctl start asset-inventory
```

## 8. 백업·보존

- `asset-backup.timer` → `backup.sh`: SQLite online backup + gzip, `backups/` 30일 보관, 권한 600.
- `asset-retention.timer` → `retention-runner.ts`: 감사로그·접속기록 1년 초과분 프루닝(append-only 트리거가 1년 이내 삭제를 막는다).
- 복구 리허설: `restore.sh <백업파일>` 을 스테이징에서 분기 1회.

## 9. 계정 문제

- 비밀번호 분실: 다른 총괄이 설정 → 사용자 관리 → 초기화. 총괄이 유일하면 `scripts/deploy/reset-password-server.cjs`.
- 2단계 인증 기기 분실: 다른 총괄이 사용자 관리 → 🛡 해제. 총괄이 유일하면 `scripts/deploy/disable-mfa.cjs`.
- **`db-seed.mjs` 는 재설정 용도로 쓰지 말 것** — 전체 테이블을 DROP 한다.

## 10. 문제해결

| 증상 | 확인 |
|---|---|
| 서비스가 안 뜸 | `sudo journalctl -u asset-inventory -n 100` · `.env` 의 `ASSET_DB_PATH` 경로 · `data.db` 소유자 `asset` |
| 로그인 500 | `/api/health` 의 `db` 가 `error` 면 DB 파일 권한/경로 |
| 화면이 흰 화면 | CSP 차단 — `verify-build.mjs` 가 정적 프리렌더 0건이었는지(nonce 미부착 페이지) |
| nginx 502 | `ss -tlnp | grep 3100` · `NEXT_INTERNAL_PORT` 와 nginx `proxy_pass` 포트 일치 |
| 인증서 경고 | 공존시스템 인증서 만료 — 그쪽에서 갱신 후 `nginx -s reload` |

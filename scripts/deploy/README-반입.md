# 폐쇄망 반입·배포 안내

반입 매체(USB/망연계)에 담을 것은 **`asset-inventory-offline.tar.gz` 하나**입니다.
(번들 안에 앱·Node 런타임·native 모듈·nginx RPM·배포 스크립트·문서가 모두 들어 있습니다. 인터넷 불필요.)

---

## 1. 반입 전 — 무결성 확인

배포 PC(반출 측)와 폐쇄망 서버(반입 측)에서 **같은 값이 나와야** 합니다.

```bash
sha256sum asset-inventory-offline.tar.gz      # Linux
certutil -hashfile asset-inventory-offline.tar.gz SHA256   # Windows
```

동봉된 `SHA256SUMS.txt` 의 값과 대조하세요. 다르면 전송이 깨진 것이니 다시 받습니다.

---

## 2. 배포 — 한 줄

폐쇄망 서버에 파일을 올린 뒤:

```bash
tar -xzf asset-inventory-offline.tar.gz
sudo bash asset-inventory/scripts/deploy/deploy.sh
```

`deploy.sh` 가 **기존 설치 여부를 자동 판별**합니다.

| 상황 | 자동 선택 경로 | 동작 |
|---|---|---|
| `/opt/asset-inventory/data.db` 있음 | **업그레이드** | 데이터·설정 보존하고 앱만 교체, 롤백본 자동 생성 |
| 없음 | **신규설치** | nginx 설치(번들 RPM) + 앱 배치 + systemd 등록 |

### 먼저 확인만 하고 싶다면 (아무것도 바꾸지 않음)

```bash
sudo bash asset-inventory/scripts/deploy/deploy.sh --check
```

현재 설치 상태, 수행 예정 작업, **현재 메뉴 권한이 어느 화면을 막게 되는지**까지 출력합니다.

### 신규설치 시 도메인/인증서 지정

```bash
sudo PUBLIC_FQDN=itam.example.go.kr bash asset-inventory/scripts/deploy/deploy.sh
# 인증서 경로가 기본과 다르면
sudo SSL_CRT=/경로/site.crt SSL_KEY=/경로/site.key PUBLIC_FQDN=itam.example.go.kr \
  bash asset-inventory/scripts/deploy/deploy.sh
```

---

## 3. 업그레이드가 보존하는 것 / 교체하는 것

| 보존 (건드리지 않음) | 교체 |
|---|---|
| `data.db` (+WAL/SHM) — 자산·사용자·감사로그 | `.next` (빌드 산출물) |
| `.env` — AUTH_SECRET·포트·도메인 | `src`, `scripts`, `docs` |
| `node/` — 번들 런타임 | `node_modules` |
| `tls/`, `backups/` | `package.json`, `next.config.ts` |

배포 직전 **DB 백업이 자동 생성**됩니다 → `/opt/asset-inventory/backups/data.db.preupgrade-<시각>.gz`

---

## 4. 배포 후 확인

스크립트가 끝나면 아래를 자동 출력합니다. 눈으로 확인하세요.

- `서비스: active`
- `내부 /login → 200`
- `✓ nonce CSP 적용`
- `https(nginx) /login → 200`
- 마이그레이션 결과 (자산 수 · 사용자 수 · `user_version`)

추가 점검:

```bash
# 핵심 화면 데이터 불변식 (자산 IP 렌더, 실장도, 배선, 비로그인 401 …)
cd /opt/asset-inventory && sudo -u asset ./node/bin/node scripts/smoke.mjs
# 부속자산이 없는 환경이면: SMOKE_MIN_SUBASSETS=0
```

---

## 5. 첫 기동 시 자동 실행되는 스키마 마이그레이션

앱이 DB 를 처음 건드리는 요청에서 **자동 수행**됩니다(수동 작업 불필요).

1. 메뉴 권한 기본 시드 — 신규 메뉴 행 추가, 레지스트리 밖 유령 행 정리
2. 감사로그 `entity_type` 확장 — 계정·팀·권한 변경 기록 가능하도록 테이블 재빌드
3. `feedback` / `feedback_votes` 테이블 생성 (개선의견 접수)
4. 날짜 정규화 (`user_version` 2) — 엑셀 이관 과정에서 들어온 비표준 날짜를 `YYYY-MM-DD` 로 통일

> 4번에서 **해석할 수 없는 날짜**가 있으면 서비스 로그에 목록이 남습니다. 해당 자산만 화면에서 수기 정정하세요.
> `sudo journalctl -u asset-inventory | grep MIGRATION`

---

## 6. 롤백

업그레이드 스크립트가 종료 시 **복원 명령을 그대로 출력**합니다. 형식:

```bash
sudo systemctl stop asset-inventory
sudo cp -a /opt/asset-inventory.rollback-<시각>/. /opt/asset-inventory/
sudo chown -R asset:asset /opt/asset-inventory
sudo systemctl start asset-inventory
```

DB 까지 되돌려야 한다면 (자산 데이터가 오염된 경우에만):

```bash
sudo systemctl stop asset-inventory
sudo -u asset sh -c 'gunzip -c /opt/asset-inventory/backups/data.db.preupgrade-<시각>.gz > /opt/asset-inventory/data.db'
sudo systemctl start asset-inventory
```

---

## 7. 계정 문제

관리자 비밀번호를 분실했거나 계정이 잠겼을 때 — **`db-seed.mjs` 를 실행하면 안 됩니다**(전체 테이블 삭제).

```bash
# 비밀번호 재설정 (해당 계정 1행만 갱신, 잠금 해제 포함)
sudo -u asset /opt/asset-inventory/node/bin/node \
  /opt/asset-inventory/scripts/deploy/reset-password-server.cjs \
  /opt/asset-inventory <이메일> '<새비밀번호>'
```

비밀번호 정책: 8자 이상, 영문/숫자/특수문자 중 2종 이상.

---

## 8. 문제 발생 시 로그

```bash
sudo systemctl status asset-inventory
sudo journalctl -u asset-inventory -n 100 --no-pager
sudo journalctl -u asset-inventory -p err --no-pager
sudo nginx -t && sudo systemctl status nginx
```

상세 운영 절차는 번들 안 `docs/관리자매뉴얼.md`, 배포 상세는 `docs/DEPLOY.md` 를 참고하세요.

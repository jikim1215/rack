# 폐쇄망 반입·배포 안내

반입 매체(USB/망연계)에 담을 것은 **`asset-inventory-offline.tar.gz` + `SHA256SUMS.txt`** 두 파일입니다.
(번들 안에 앱·Node 런타임·native 모듈·nginx RPM·배포 스크립트·문서가 모두 들어 있습니다. 인터넷 불필요.)
같은 내용의 한 장짜리 안내는 빌드 산출물 `배포방법.txt` 입니다.

---

## 1. 운영 중인 서버에 바로 적용 — 한 줄

두 파일을 서버의 같은 폴더(예: 운영자 홈)에 올린 뒤, 그 폴더에서:

```bash
sha256sum -c SHA256SUMS.txt && rm -rf asset-inventory && tar -xzf asset-inventory-offline.tar.gz && sudo bash asset-inventory/scripts/deploy/deploy.sh
```

| 단계 | 하는 일 | 실패 시 |
|---|---|---|
| `sha256sum -c` | 전송 무결성 대조 | `FAILED` → 중단. 파일 다시 복사 |
| `rm -rf asset-inventory` | 이전에 풀어둔 번들 폴더 정리(운영 앱 `/opt/asset-inventory` 와 무관) | — |
| `tar -xzf` | 새 번들 전개 | 디스크 여유 확인 |
| `deploy.sh` | 기존 설치 감지 → **업그레이드** / 없으면 **신규설치** | 단계별 메시지 + 롤백 명령 출력 |

먼저 확인만 하려면 마지막을 `deploy.sh --check` 로 바꿉니다(아무것도 변경하지 않음 — 현재 상태, 수행 예정 작업, 현재 메뉴 권한이 막게 될 화면까지 출력).

Windows 에서 반출 전 체크섬 확인: `certutil -hashfile asset-inventory-offline.tar.gz SHA256` → `SHA256SUMS.txt` 값과 비교.

---

## 2. 업그레이드가 하는 일 (`upgrade-inplace.sh`)

1. **DB 온라인 백업** → `/opt/asset-inventory/backups/data.db.preupgrade-<시각>.gz` (권한 600)
2. 서비스 중지 → **이전 앱 트리 보관** → `/opt/asset-inventory.rollback-<시각>/`
3. 앱 트리 교체 → native 로드 확인
4. **nginx `itam.conf` 현행화** — `X-Forwarded-For $proxy_add_x_forwarded_for` 한 줄만 `$remote_addr` 로 교체(클라이언트 IP 위조 차단). 원본은 `itam.conf.bak-<시각>` 으로 백업, `nginx -t` 통과 시에만 reload, 실패하면 자동 복원. 이미 최신이면 건드리지 않음
5. 서비스 기동 → `/api/health` 200 대기(= 스키마 마이그레이션 완료)
6. **재기동 유실 값 복구** — 2026-10-01 이전 판은 서버가 재시작할 때마다 자산의 **소유 팀 · 랙 L/R(반폭) · 현행 확인 도장 · 일괄등록 배치** 값을 비웠다. 서비스를 잠깐(수 초) 멈추고 `restore-lost-fields.cjs --apply` 가 **빈 값만** 감사로그의 마지막 기록값으로 채운다(현재 값은 절대 덮어쓰지 않음, 복구한 자산마다 감사로그 1행 `system:restore-lost-fields`). 다시 실행하면 0건
7. 스모크(`/login` 200 · nonce CSP · nginx 경유 200) → 마이그레이션 결과(user_version · 테이블 건수)

| 보존 (건드리지 않음) | 교체 |
|---|---|
| `data.db` (+WAL/SHM) — 자산·사용자·감사로그 | `.next` (빌드 산출물) |
| `.env` — AUTH_SECRET·포트·도메인 | `src`, `scripts`, `docs` |
| `node/` — 번들 런타임 | `node_modules` |
| `tls/`, `backups/` | `package.json`, `next.config.ts` |

서비스 중단은 2~6 구간(보통 20초 내외)입니다.

---

## 3. 신규설치 옵션

기존 설치가 없으면 같은 한 줄이 신규설치(nginx RPM + 앱 + systemd + 최소 DB 초기화)로 동작합니다. 도메인·인증서가 기본과 다르면:

```bash
sudo PUBLIC_FQDN=itam.example.go.kr bash asset-inventory/scripts/deploy/deploy.sh
sudo SSL_CRT=/경로/site.crt SSL_KEY=/경로/site.key PUBLIC_FQDN=itam.example.go.kr \
  bash asset-inventory/scripts/deploy/deploy.sh
```

초기 계정 `admin@example.go.kr / admin123` — 첫 로그인 후 비밀번호 변경 + 2단계 인증 등록(총괄은 등록 전 다른 화면 사용 불가).

---

## 4. 배포 후 확인

스크립트 출력에서 `서비스: active` · `내부 /login → 200` · `✓ nonce CSP 적용` · `https(nginx) /login → 200` 을 확인합니다. 이어서 DB 를 직접 확인합니다(**읽기 전용** — 운영 중 실행해도 안전):

```bash
Q="sudo -u asset /opt/asset-inventory/node/bin/node /opt/asset-inventory/scripts/deploy/db-query.cjs"
$Q summary      # user_version 2 + 테이블 건수 — 배포 전과 같아야 정상
$Q integrity    # ok / 외래키 위반 0건 / wal
$Q admins       # 활성 총괄 계정 + 2단계 인증 등록 여부
$Q bad-dates    # 마이그레이션이 해석 못 한 날짜 (있으면 화면에서 수기 정정)
$Q restored     # 재기동 유실 복구 내역 (6단계가 채운 자산·값)
```

전체 점검 목록은 `$Q` 만 실행하면 나오고, 설명은 `docs/관리자매뉴얼.md` §7 에 있습니다.

핵심 화면 불변식 스모크(선택 — 총괄 2단계 인증이 등록돼 있으면 `DEPLOY.md` §6-2 절차로):

```bash
sudo install -m 644 /opt/asset-inventory/scripts/smoke.mjs /tmp/smoke.mjs
cd /opt/asset-inventory && sudo -u asset env BASE_URL=http://127.0.0.1:3100 \
  SMOKE_USER=<총괄계정> SMOKE_PASS='<비밀번호>' ./node/bin/node /tmp/smoke.mjs; sudo rm -f /tmp/smoke.mjs
```

---

## 5. 첫 기동 시 자동 실행되는 스키마 마이그레이션

앱이 DB 를 처음 건드리는 요청에서 **자동 수행**됩니다(수동 작업 불필요): 메뉴 권한 기본 시드, 감사로그 `entity_type` 확장, 개선의견 테이블, 날짜 정규화(`user_version` 2), 2단계 인증·현행 확인 컬럼, 인덱스.

해석할 수 없는 날짜가 있으면 로그와 DB 양쪽에서 확인할 수 있습니다:

```bash
sudo journalctl -u asset-inventory | grep MIGRATION
sudo -u asset /opt/asset-inventory/node/bin/node /opt/asset-inventory/scripts/deploy/db-query.cjs bad-dates
```

---

## 6. 롤백

업그레이드 스크립트가 종료 시 **롤백 명령을 그대로 출력**합니다. `<시각>` 은 출력에 나온 `YYYYMMDD_HHMMSS`.

```bash
# 앱 트리(+ 업그레이드가 바꾼 경우 nginx itam.conf)를 직전 판으로 — DB 는 유지 (보통 이것)
sudo bash /opt/asset-inventory.rollback-<시각>/rollback.sh <시각>
# DB 까지 업그레이드 직전 백업으로 (자산 데이터가 오염된 경우에만 — 그 사이 입력분은 사라집니다)
sudo bash /opt/asset-inventory.rollback-<시각>/rollback.sh <시각> --with-db
```

`rollback.sh` 는 앱 트리를 **통째로 교체**합니다(덮어쓰기가 아님 — 새 판에만 있는 파일이 남아 구판과 섞이지 않게), 끝에 `/api/health` 200 을 확인합니다.

> 구판으로 되돌리면 재기동 유실 결함도 되돌아옵니다(다음 재시작에 소유 팀 등이 다시 비워짐). 원인을 해결한 뒤 가능한 한 빨리 새 판을 다시 적용하세요 — 재적용 시 6단계가 다시 복구합니다.

---

## 7. 계정 문제

관리자 비밀번호를 분실했거나 계정이 잠겼을 때 — **`db-seed.mjs` 를 실행하면 안 됩니다**(전체 테이블 삭제).

```bash
# 비밀번호 재설정 (해당 계정 1행만 갱신, 잠금 해제 포함)
sudo -u asset /opt/asset-inventory/node/bin/node \
  /opt/asset-inventory/scripts/deploy/reset-password-server.cjs \
  /opt/asset-inventory <이메일> '<새비밀번호>'
# 2단계 인증 기기 분실 (다른 총괄이 없을 때만)
sudo -u asset /opt/asset-inventory/node/bin/node \
  /opt/asset-inventory/scripts/deploy/disable-mfa.cjs /opt/asset-inventory <이메일>
# 현재 잠금 상태 확인
sudo -u asset /opt/asset-inventory/node/bin/node /opt/asset-inventory/scripts/deploy/db-query.cjs lockouts
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

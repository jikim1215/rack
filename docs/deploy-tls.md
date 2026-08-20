# 오프라인 배포 · HTTPS(Node 내장 TLS) 가이드 (P12 / AC-15·16·21·22)

폐쇄망(인터넷 차단) RockyLinux 8.10 단일 서버에 외부 의존 없이 설치·운영하기 위한 절차다.
ADR-008(Node 내장 TLS, reverse proxy 미동봉) / ADR-011(better-sqlite3 + native Plan B)을 따른다.

## 1. 오프라인 릴리스 빌드 (빌드 PC = Rocky 8.10)

```bash
# glibc 2.28(Rocky 8.10) 동일 OS에서 빌드해야 native ABI가 타깃과 일치 (AC-16)
bash scripts/deploy/build-release.sh
# 산출물: dist/asset-inventory-offline.tar.gz
#  - .next/standalone (Next 독립 실행) + static/public
#  - src/ (런타임 lib: db/authz/retention/asset-rules …) + scripts/ (server-tls, retention-runner, import, backup …)
#  - node_modules/better-sqlite3 prebuilt + Plan B(native-planb.sh 소스 리빌드)
#  - 번들 Node (node-linux-x64.tar.xz)
```

`build-release.sh`는 `ldd --version`으로 glibc 2.28을 단언한다(불일치 시 중단; 검증 전용은 `ALLOW_GLIBC_MISMATCH=1`). 번들 Node는 **22.6 이상**이어야 한다(`retention-runner.ts`/`import-asset-final.ts`가 `--experimental-strip-types`로 `.ts` 실행 — setup.sh가 설치 시 버전 단언). native(better-sqlite3)는 앱이 실제 로드하는 `.next/standalone/node_modules/better-sqlite3` 경로에 동봉된다.

릴리스 tar는 `asset-inventory/` 한 디렉터리로 풀린다(플랫 트리: `.next/`·`src/`·`scripts/`·`node_modules/`·번들 Node tar). `setup.sh`는 자신의 두 단계 위(`scripts/deploy/../..`)를 번들 루트로 인식해 `APP_DIR`로 복사한다.

## 2. 설치 (운영 서버, 무인터넷)

```bash
tar -xzf asset-inventory-offline.tar.gz
sudo bash asset-inventory/scripts/deploy/setup.sh
```

setup.sh 동작:
1. `/opt/asset-inventory`에 앱 + 번들 Node 배치, `asset` 서비스 계정 생성.
2. **native smoke**: `better-sqlite3` 로드 검증. 실패 시 `scripts/deploy/native-planb.sh`로 소스 리빌드(Plan B).
3. **self-signed 인증서** 생성: `tls/key.pem`(권한 **600**) + `tls/cert.pem`, SAN=호스트명/IP (AC-21).
4. `.env` 생성: `AUTH_SECRET`(48B 랜덤 강제), **`COOKIE_SECURE=true`**, TLS 경로/포트.
5. systemd `asset-inventory.service` = `server-tls.mjs` (CAP_NET_BIND_SERVICE로 443/80 바인드, 비root).
6. 보존/백업 타이머 설치: `asset-retention.timer`(03:30), `asset-backup.timer`(02:00).
7. 방화벽 80/443 개방, 기동 후 **HTTPS native smoke**(`curl -sk https://localhost/login`).

## 3. HTTPS / HTTP→HTTPS (server-tls.mjs)

`scripts/deploy/server-tls.mjs` (Node 내장 모듈만):
- 내부적으로 Next standalone(HTTP, `127.0.0.1:NEXT_INTERNAL_PORT`)을 자식 프로세스로 기동.
- `https.createServer`(443)로 **TLS 종단** 후 내부 Next로 프록시(`x-forwarded-proto: https`).
- `http`(80)는 **301 HTTPS 리다이렉트**.
- 쿠키는 `COOKIE_SECURE=true`로 `Secure` 플래그 적용(HTTPS 전용).

검증(개발/스모크): `artifacts/G012/tls-smoke.txt` — 자체서명 인증서로 HTTPS 200 + HTTP 301 확인.

## 4. 데이터 이관 (1회)

```bash
sudo -u asset ASSET_DB_CWD=/opt/asset-inventory \
  /opt/asset-inventory/node/bin/node --experimental-strip-types \
  /opt/asset-inventory/scripts/import-asset-final.ts --file /path/asset-final.xlsx --dry-run --expect 587
# 검증 후 --dry-run 제거하여 실제 이관 (멱등 batch, reconciliation, 감사로그)
```

> **DB 경로 일관성 (중요):** 앱(`getDb`)은 `.env`의 `ASSET_DB_PATH`(setup.sh가 `${APP_DIR}/data.db`로 설정)를 우선 사용합니다. standalone 서버는 기동 시 자기 디렉터리로 cwd를 바꾸므로, `ASSET_DB_PATH`가 없으면 시드/이관한 파일과 다른 빈 DB를 읽어 **로그인이 "등록된 사용자가 없습니다"(503)** 로 막힙니다. 이관/시드도 동일 경로를 가리키게 하세요(`ASSET_DB_PATH=${APP_DIR}/data.db`). 빈 DB로 기동하면 서버 로그에 `[SETUP] … 사용자가 없습니다` 경고가 출력됩니다.
> 로컬 개발(`npm run dev`)은 cwd가 저장소 루트라 `ASSET_DB_PATH` 없이 `./data.db`를 읽습니다 → `node scripts/db-seed.mjs` 후 `npm run dev`면 됩니다.

## 5. 백업 · 보존 · 복구 (AC-20/22)

- 백업: `asset-backup.timer`(매일 02:00) → `backup.sh` → `db-backup.mjs`(번들 better-sqlite3 online backup + gzip). 백업 파일 권한 **600**, N일 초과 자동 정리. **sqlite3 CLI 불필요**(폐쇄망 최소설치 대응).
- 보존 프루닝: `asset-retention.timer`(매일 03:30) → `retention-runner.ts` → 감사로그/접속기록 **1년 초과** 삭제.
- **상호배제**: 백업과 프루닝은 공용 `maintenance.lock`(O_EXCL/noclobber, 스테일 1h 회수)로 동시 실행 방지.
- **복구 리허설**(무중단): `bash scripts/deploy/restore.sh --rehearse <backup.gz>` → 임시 복원 + `PRAGMA integrity_check` + assets 행수 검증.
- 실복원: `sudo bash scripts/deploy/restore.sh <backup.gz>` (서비스 중지 → pre-restore 백업 → 복원 → 검증 → 재기동).

## 6. 운영 점검

```bash
systemctl status asset-inventory
journalctl -u asset-inventory -f
systemctl list-timers 'asset-*'
```

> 첫 로그인(admin) 후 비밀번호 변경 필수. self-signed 인증서이므로 브라우저 경고는 정상(폐쇄망 내부망 신뢰).

# 보안 점검 체크리스트 (P10 보안 하드닝 · AC-17/18/20)

폐쇄망(air-gapped) 다중팀 정보시스템 자산관리 앱의 자체 보안 점검표. JS 시큐어코딩 / 공개SW 보안 항목 기준.
각 항목은 코드 근거(파일:기능)와 함께 점검한다. [x]=구현·검증됨.

## 1. 인증 / 세션 (AC-17)
- [x] 세션 쿠키 `httpOnly` — JS에서 토큰 접근 불가. `src/lib/auth.ts` sessionCookieOptions.httpOnly=true.
- [x] 세션 쿠키 `secure` — HTTPS 배포 시 `COOKIE_SECURE=true`로 활성(setup.sh). `sessionCookieOptions.secure=process.env.COOKIE_SECURE==='true'`.
- [x] 세션 쿠키 `sameSite=strict` — CSRF 방어. sessionCookieOptions.sameSite='strict'.
- [x] 세션 토큰 HMAC-SHA512 서명 + 만료(기본 8h, SESSION_TTL_HOURS). `createSessionToken`/`verifySessionToken`.
- [x] 토큰 서명 **상수시간 비교**(timingSafeEqual) — 타이밍 공격 방어. `verifySessionToken`.
- [x] AUTH_SECRET 미설정/기본값이면 운영(NODE_ENV=production)에서 **기동 거부**(fail-fast). `getSecret`.
- [x] 비밀번호 scrypt(N=16384,r=8,p=1) + 32바이트 솔트, 검증은 timingSafeEqual. `hashPassword`/`verifyPassword`.
- [x] **2단계 인증(TOTP, RFC 6238)** — 사용자별 등록(설정 → 2단계 인증). 비밀번호 통과 시 세션 대신 3분 대기 토큰(`pur='mfa'`, getSession/미들웨어가 거부) 발급 → `/api/auth/mfa` 코드 교환. replay 차단(`totp_last_counter`), ±1스텝, 코드 시도 5회/15분 잠금(`m:<user>`), 백업코드 10개 scrypt 해시·1회용. 외부 패키지 0 (`src/lib/totp.ts`, RFC 4226/6238 벡터 테스트 통과). ADR-017.
- [x] **MFA 등록 강제** — `MFA_REQUIRED_ROLES`(기본 admin). 미등록이면 세션에 `msr` 플래그 → 미들웨어가 /settings 외 전부 차단(API 403 `MFA_SETUP_REQUIRED`), 등록 완료 시 세션 재발급으로 즉시 해제. `scripts/verify-hardening.mjs`.
- [x] **비밀번호 정책은 평문을 아는 클라이언트가 검사** (`src/lib/password-policy.ts`, 변경/초기화/계정생성 전부). 서버는 sha512 프리해시만 받으므로 평문 정책을 판정할 수 없다 — 과거 `validatePasswordPolicy(해시)` 는 항상 통과하는 허수 검사였고(그래서 정책 위반 비밀번호가 존재), 지금은 "프리해시 형식인가" 만 검증. 정책 미달 비밀번호로 로그인하면 브라우저가 `/api/auth/password/weak` 로 자진 신고 → must_change 강제(엄격해지는 방향만 가능하므로 악용 가치 없음).
- [x] 엑셀 업로드 상한 20MB/2만 행 (`src/lib/validation/upload.ts`, 임포트 4종 공통) — XLSX.read 전 차단.
- [x] `/api/health` 무인증 — 업무 수치 미노출(가드레일 테스트가 업무 테이블 조회를 금지), no-store.
- [x] MFA 해제 경로 통제 — 본인: 현재 코드 필수(세션 탈취로는 못 끕) / 총괄: `/api/users/[id]/mfa` DELETE(감사로그 + 세션 무효화) / 서버 CLI `disable-mfa.cjs`(총괄 본인 잠김).

## 2. 비밀번호 정책 (AC-18)
- [x] 최소 8자, 영문/숫자/특수문자 중 2종 이상, 256자 이하. `validatePasswordPolicy` (auth.ts) — 단일 출처.
- [x] 적용 경로: 사용자 생성 `api/users` POST, 관리자 비번 초기화 `api/users/[id]` PUT, 본인 변경 `api/auth/password` PUT.
- [x] 로그인 입력 길이 상한(username≤50, password≤256) — DoS 방어. `api/auth/login`.

## 3. 무차별 대입 방어 (AC-17)
- [x] 로그인 5회 실패 시 15분 IP 잠금. `api/auth/login` checkRateLimit/recordFailedAttempt (MAX_ATTEMPTS=5, LOCKOUT_DURATION=15분).
- [x] 사용자 열거 방지 — 존재하지 않는 계정/오답 동일 메시지·동일 경로. `api/auth/login`.
- [x] 잠금/실패는 접속기록(access_logs)에 사유 코드와 함께 기록. logAccess(action='fail').

## 4. 입력 검증 / 인젝션 (AC-18)
- [x] 모든 DB 접근 파라미터 바인딩(prepared statement) — SQL 인젝션 방어. (better-sqlite3 `?` 바인딩 전역 사용.)
- [x] 정렬/컬럼 동적 식별자는 화이트리스트. `assertSafeColumn` (authz.ts).
- [x] 엑셀 업로드 매직바이트 검사(PK\x03\x04 등) + 타입/상태 화이트리스트. `validation/asset-rules.ts` isXlsxBuffer/VALID_TYPES/VALID_STATUSES.
- [x] 자산 검색 다중 IP 파라미터화 + 팀 스코프. `asset-search.ts` ipSearchClause.

## 5. 인가 / 데이터 경계 (AC-17, ADR-009)
- [x] 서버측 인가가 신뢰 경계 — 모든 데이터 반환/쓰기 경로에 `scopeWhere` 기본 거부(default-deny). `authz.ts`.
- [x] RSC 페이지도 스코프 적용 또는 admin 전용 게이트(admin=전역 스코프). `verify-page-scope.ts` 13 SCOPED + 2 ADMIN.
- [x] 피어 조인(포트맵 등) 교차팀 식별 누수 차단. `verify-portmap-peer.ts`.
- [x] `assets.team_id` 단일 소유권 권위; `assets.department`는 읽기전용 레거시 그림자(앱은 절대 쓰지 않음). ADR-009.
- [x] **메뉴 권한(menu_permissions) 서버 강제** — 모든 API 는 `withApi` + `assertMenuAccess/Write/Approve`, 모든 메뉴 페이지는 `requireMenuPage` 를 거친다. 설정→메뉴 권한의 접근/쓰기/승인 토글이 URL 직접 입력·API 직접 호출에도 적용(접근 없음→/access-denied, API 403). `authz.ts` menuPermission / `tests/api-route-guard.test.ts` 가 누락을 강제. ADR-015.
- [x] 감사로그에 **관리자 행위** 기록 — 계정 생성/수정/삭제/비번초기화(user), 팀(team), 메뉴 권한 변경(permission, 역할별 전·후 맵), 개선의견 처리(feedback). `audit.ts` 가 password_hash/token_version 을 redact.

## 6. 정보 노출 / 로깅 (AC-20)
- [x] 에러 응답에 스택/내부 경로 미노출 — `withApi`/`apiErrorResponse` 가 인가(401/403)·검증(400)·JSON 파싱(400)·SQLite 제약(400/409)을 한국어 JSON 으로 변환하고, 그 외는 메시지 없는 500 + 서버 로그. 쓰기 입력은 `validation/input.ts`(enum/길이/정수/날짜/경로 id) 로 사전 검증(P2).
- [x] 비밀번호/시크릿은 로그·감사로그에 평문 미기록. access_logs/audit_logs는 식별자·사유만.
- [x] 감사로그 append-only(UPDATE ABORT, DELETE는 365일 초과만). `db.ts` 트리거 (AC-1).
- [x] 감사/접속 기록 1년 보존 후 프루닝. `retention.ts` (AC-19).

## 7. 배포 / 운영 (AC-21/22)
- [x] HTTPS(Node 내장 TLS), HTTP→HTTPS 301. `scripts/deploy/server-tls.mjs`.
- [x] TLS 개인키 권한 600, .env/data.db 권한 600. `setup.sh`.
- [x] 백업/복구 리허설, 백업 파일 권한 600, 보존 프루닝과 maintenance.lock 상호배제. `backup.sh`/`restore.sh`.
- [x] 오프라인 번들 — 외부 네트워크 의존 0(번들 Node + native + sqlite). `build-release.sh`.

## 8. 취약·구버전 컴포넌트 (OWASP A06)
- [x] `xlsx`(SheetJS) **0.18.5 → 0.20.3** 업그레이드 — CVE-2023-30533(프로토타입 오염, fix≥0.19.3)·CVE-2024-22363(ReDoS, fix≥0.20.2) 해소. npm 레지스트리 최신이 0.18.5에 머물러, 공식 CDN 패치판 tarball을 `vendor/xlsx-0.20.3.tgz`로 동봉하고 `package.json`에 `file:vendor/xlsx-0.20.3.tgz`로 고정(오프라인 `npm ci` 호환). import/export/template/ledger 라우트 무회귀 검증(정본 587행 dry-run 동일·라이브 라우트 200/유효 xlsx).
- [x] 보안 응답 헤더 — X-Frame-Options:DENY·X-Content-Type-Options:nosniff·Referrer-Policy·Permissions-Policy + `poweredByHeader:false`. `next.config.ts` headers().
- [x] **CSP nonce** — `src/middleware.ts` 가 요청마다 nonce 를 만들어 `script-src 'self' 'nonce-…' 'strict-dynamic'`(‘unsafe-inline’ 없음), `default-src 'self'` 로 외부 출처 차단. /login 은 force-dynamic. ADR-016. 검증: `npm run verify:authz`(nonce 부착·요청별 변화 확인).
- [ ] (운영 권고) 의존성 정기 점검 — 폐쇄망이라 자동 SCA 불가 시, 릴리스 전 `npm ls`/CVE 수동 대조.

## 점검 방법
- 자동(단위): `scripts/verify-authz-matrix.ts`, `scripts/verify-page-scope.ts`, `scripts/verify-retention.ts`, `scripts/verify-asset-rules.ts` (모두 실 shipped lib 호출).
- 자동(실 핸들러 e2e, 인가·검증·CSP·MFA): `npm run verify:api` = `scripts/verify-authz.mjs`(메뉴 권한 강제/승인/입력 검증 400/관리자 감사로그/CSP nonce/세션 TTL) + `scripts/verify-feedback.mjs` + `scripts/verify-mfa.mjs`(등록→대기토큰 차단→코드 교환→replay→백업코드 1회성→해제, 21항목). 단위: `tests/authz-menu.test.ts`, `tests/validation-input.test.ts`, `tests/api-route-guard.test.ts`(모든 route.ts 스캔).
- 자동(실 핸들러 e2e): `scripts/e2e-security.mjs` — 기동 중인 standalone 서버에 대해 비밀번호 정책(약함→400/강함→OK), 토큰 위조 거부(서명 변조→401/redirect), Secure 쿠키를 실 API 경로로 검증(auth.ts가 next/headers 의존이라 단위 로드 불가 → 실 핸들러로 검증).
- 수동: 본 체크리스트 항목별 코드 근거 재확인 후 릴리스 태깅.

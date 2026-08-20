# 보안 점검 체크리스트 (P10 보안 하드닝 · AC-17/18/20)

폐쇄망(air-gapped) 다중팀 정보시스템 자산관리 앱의 자체 보안 점검표. JS 시큐어코딩 / 공개SW 보안 항목 기준.
각 항목은 코드 근거(파일:기능)와 함께 점검한다. [x]=구현·검증됨.

## 1. 인증 / 세션 (AC-17)
- [x] 세션 쿠키 `httpOnly` — JS에서 토큰 접근 불가. `src/lib/auth.ts` sessionCookieOptions.httpOnly=true.
- [x] 세션 쿠키 `secure` — HTTPS 배포 시 `COOKIE_SECURE=true`로 활성(setup.sh). `sessionCookieOptions.secure=process.env.COOKIE_SECURE==='true'`.
- [x] 세션 쿠키 `sameSite=strict` — CSRF 방어. sessionCookieOptions.sameSite='strict'.
- [x] 세션 토큰 HMAC-SHA512 서명 + 만료(24h). `createSessionToken`/`verifySessionToken`.
- [x] 토큰 서명 **상수시간 비교**(timingSafeEqual) — 타이밍 공격 방어. `verifySessionToken`.
- [x] AUTH_SECRET 미설정/기본값이면 운영(NODE_ENV=production)에서 **기동 거부**(fail-fast). `getSecret`.
- [x] 비밀번호 scrypt(N=16384,r=8,p=1) + 32바이트 솔트, 검증은 timingSafeEqual. `hashPassword`/`verifyPassword`.

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

## 6. 정보 노출 / 로깅 (AC-20)
- [x] 에러 응답에 스택/내부 경로 미노출 — 사용자向 한국어 메시지만 반환. (라우트들의 catch/검증 분기.)
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
- [x] 보안 응답 헤더 — CSP(`default-src 'self'`)·X-Frame-Options:DENY·X-Content-Type-Options:nosniff·Referrer-Policy·Permissions-Policy + `poweredByHeader:false`. `next.config.ts` headers().
- [ ] (운영 권고) 의존성 정기 점검 — 폐쇄망이라 자동 SCA 불가 시, 릴리스 전 `npm ls`/CVE 수동 대조.

## 점검 방법
- 자동(단위): `scripts/verify-authz-matrix.ts`, `scripts/verify-page-scope.ts`, `scripts/verify-retention.ts`, `scripts/verify-asset-rules.ts` (모두 실 shipped lib 호출).
- 자동(실 핸들러 e2e): `scripts/e2e-security.mjs` — 기동 중인 standalone 서버에 대해 비밀번호 정책(약함→400/강함→OK), 토큰 위조 거부(서명 변조→401/redirect), Secure 쿠키를 실 API 경로로 검증(auth.ts가 next/headers 의존이라 단위 로드 불가 → 실 핸들러로 검증).
- 수동: 본 체크리스트 항목별 코드 근거 재확인 후 릴리스 태깅.

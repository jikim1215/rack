# Architecture Decision Records

## 철학
폐쇄망 공공기관 환경에서 단일 서버로 운영 가능한 최소 의존성 솔루션. 설치/운영 단순성 최우선. 작동하는 최소 구현을 선택.

---

### ADR-001: Next.js 15 App Router 선택
**결정**: Next.js 15 App Router (Server Components + Client Components)
**이유**: 풀스택 단일 프레임워크로 프론트/백엔드 동시 처리. Server Components로 DB 직접 접근 가능하여 API 중간 레이어 최소화.
**트레이드오프**: React 생태계 종속. 하지만 폐쇄망에서 별도 프론트/백 분리는 운영 부담 가중.

### ADR-002: SQLite (better-sqlite3) 선택
**결정**: SQLite 단일 파일 DB, better-sqlite3 동기 드라이버
**이유**: 별도 DB 서버 설치/운영 불필요. 파일 1개로 백업/이전 가능. 공공기관 내부용 수십~수백 대 자산 규모에 충분.
**트레이드오프**: 동시 쓰기 제한. 하지만 단일 관리자 환경에서 문제 없음. WAL 모드로 읽기 동시성 확보.

### ADR-003: 외부 인증 라이브러리 미사용
**결정**: Node.js crypto 내장 (scrypt + HMAC-SHA256) 기반 자체 인증
**이유**: 폐쇄망에서 추가 npm 패키지 최소화. next-auth/iron-session 등은 외부 의존성 추가. OAuth 불필요 (폐쇄망).
**트레이드오프**: JWT 표준 미준수. 하지만 내부망 단일 서버 환경에서 HMAC 서명 쿠키로 충분.

### ADR-004: Tailwind CSS 4 + Lucide React
**결정**: Tailwind CSS 4 (PostCSS 플러그인) + Lucide React 아이콘
**이유**: 빌드 시 모든 CSS/아이콘이 번들에 포함. 외부 CDN 요청 제로. 유틸리티 CSS로 빠른 UI 개발.
**트레이드오프**: Tailwind 클래스명 장황. 하지만 컴포넌트 단위로 관리하면 유지보수 문제 없음.

### ADR-005: 이미지 분석 어댑터 패턴
**결정**: `src/lib/analyzers/` 어댑터 패턴, .env 설정으로 분석기 전환
**이유**: 폐쇄망 환경에서 당장은 수동 분석(manual)만 사용하되, Tesseract OCR이나 로컬 LLM(Ollama) 설치 시 코드 변경 없이 전환 가능.
**트레이드오프**: 현재 AI 분석 미구현. 하지만 아키텍처 준비로 향후 확장 비용 최소화.

### ADR-006: xlsx + qrcode만 추가 의존성
**결정**: 외부 npm 패키지 2개만 허용 (xlsx, qrcode)
**이유**: 엑셀 처리와 QR 생성은 순수 JS 라이브러리로 폐쇄망 호환. 핵심 비즈니스 기능에 필수.
**트레이드오프**: 다른 기능(PDF 생성, 차트 등)은 직접 구현 또는 보류.

---

## 멀티팀 자산관리 확장 (asset-inventory fork, run 2026-06-21-0817-cee3)

### ADR-007: RBAC = 단일팀 소유 row-level (A1)
**결정**: users.team_id 단일 소속 + 서버측 scopeWhere. role 저장값 영문(admin=총괄/team=팀/viewer=전체열람), UI 한글 라벨. role(권한클래스)과 scope(team_id, 데이터 범위)를 분리.
**이유**: 멀티팀 기밀성(타팀 비가시)이 최우선 driver. 단일 소유가 인가 표면을 최소화해 누출 위험을 낮추고, 기존 role/감사 자산을 재사용하며 마이그레이션이 작다(EF5 소규모·EF9 부서 단일소유).
**대안**: teams + user_team_memberships(N:M) — 겸직/대행 우수하나 scope 쿼리 복잡·인가 표면 확대로 driver-1 역행.
**트레이드오프**: 한 사용자=한 팀. 겸직/대행/휴가대체 미지원 → 2차.

### ADR-008: HTTPS = Node 내장 TLS self-signed (reverse proxy 미강제)
**결정**: setup.sh가 self-signed 인증서 생성(키 권한 600) + Node 내장 TLS HTTPS + systemd 자동기동. reverse proxy 미동봉.
**이유**: 폐쇄망 단일 서버·최소 의존성(EF13), 번들/설치 단순.
**대안**: Caddy/Nginx reverse proxy 동봉 — 운영성↑이나 번들·설치 복잡도↑.
**트레이드오프**: 인증서 교체/HSTS/장애격리를 앱이 부담 → docs/deploy-tls.md로 완화. 규모 확대 시 reverse proxy 도입(2차).

### ADR-009: 저장 도메인 영문 + UI 한글 / 검증룰 단일화
**결정**: role/status DB 저장값 영문 고정(status active/maintenance/standby/retired), UI 라벨 한글. 검증룰은 src/lib/validation/asset-rules.ts 단일 모듈로 import route·스크립트가 공유.
**이유**: 정렬/비교/round-trip/API 계약 일관성, 이중 위치 드리프트 방지. AC-23은 표시 도메인으로 충족.
**대안**: 혼합 한글 enum / 이중 위치 검증 — 도메인 오염·드리프트.
**트레이드오프**: 1회성 brownfield 마이그레이션(기존 admin/user/viewer, active 매핑).

### ADR-010: viewer 전체 다운로드 유지 + export 감사이벤트 필수
**결정**: 전체열람(viewer)의 전체 다운로드 유지(EF2/AC-3/9), 단 export 시 actor/scope/컬럼셋/행수 감사이벤트 기록 필수.
**이유**: 사용자 요구(전체 조회·다운로드 가능, 수정 불가)와 추적성 양립.
**대안**: 다운로드 차단 / PII 컬럼 마스킹.
**트레이드오프**: PII 컬럼(admin_name/user_name/접속IP) 마스킹 미적용 → 2차.

### ADR-011: better-sqlite3 유지 + native Plan B
**결정**: DB 엔진 SQLite/better-sqlite3(WAL) 유지, 엔진 교체 없음. native 로드 실패 대비 Plan B(복구) 산출물 포함.
**이유**: 단일 파일·무서버·백업 용이, 읽기 지배+산발 쓰기에 충분(EF5).
**대안**: PostgreSQL / pure-JS DB.
**트레이드오프**: native ABI 리스크 → Rocky8.10 재현빌드+ldd assert+진단 체크리스트로 관리. 규모 확대 시 PostgreSQL 재평가(2차).

### ADR-012: 세션 폐기 = 무상태 HMAC 쿠키 + token_version 매요청 DB 대조
**결정**: 세션은 무상태 HMAC-SHA512 서명 쿠키를 유지하되, 토큰에 `tv`(token_version)를 넣고 매 요청 getSession에서 users.token_version/is_active/role을 DB와 대조. 비밀번호 변경·관리자 강제 재설정 시 token_version+1로 기존 토큰 일괄 무효화(구버전 토큰의 tv 부재는 0으로 간주).
**이유**: 무상태 쿠키(ADR-003)의 약점인 "발급 후 폐기 불가"를 세션 테이블 없이 해소. 계정 비활성화/권한 강등이 다음 요청부터 즉시 반영. SQLite 단건 조회는 매요청 부담 미미.
**대안**: 서버측 세션 테이블(즉시 폐기 완전 보장이나 상태 관리·정리 배치 추가) / 짧은 TTL만 의존(폐기 지연 최대 24h).
**트레이드오프**: 매 요청 users 1회 조회 추가. 하지만 폐쇄망 소규모 동시성에서 무시 가능하며, 세션 저장소 운영 부담 제거가 더 크다.

### ADR-013: 배선반(dist_frames)은 팀 비소유 공용 인프라
**결정**: dist_frames/frame_pairs는 team_id 소유권을 두지 않는 공용 인프라로 취급. 읽기는 전 팀 허용, 쓰기는 write 권한 + 감사 로그(logAudit)로 통제. linked_pair 대칭 불변식(A→B면 B→A)은 앱 계층(등록/해제 트랜잭션)이 보장하고, 운영 점검 쿼리를 상비: `SELECT fp.id FROM frame_pairs fp JOIN frame_pairs lp ON fp.linked_pair_id = lp.id WHERE lp.linked_pair_id IS NULL OR lp.linked_pair_id != fp.id`
**이유**: 배선반은 물리적으로 여러 팀 회선이 한 프레임에 공존하는 공용 설비라 row-level 팀 소유(ADR-007)를 적용하면 실물과 모델이 어긋난다. 기밀성 요구도 자산 대비 낮음(포트 라벨 수준).
**대안**: 포트 단위 팀 소유권 부여 — 실사용 대비 관리 비용 과다.
**트레이드오프**: 타팀 배선 정보가 전 팀에 보인다. 물리 배선 특성상 수용하고, 변경 추적은 감사 로그로 보완.

### ADR-014: 반폭 장비 모델 = assets.rack_side L/R/NULL
**결정**: assets.rack_side TEXT CHECK('L','R') NULL 컬럼으로 반폭 장비를 표현. NULL=전폭(모든 side와 충돌), L/R=해당 반폭. 겹침 판정은 src/lib/rack-overlap.ts의 단일 규칙 — 구간 겹침 AND (한쪽이라도 side NULL이면 충돌, 둘 다 있으면 같은 side일 때만 충돌) — 을 validateRackPlacement와 UI가 공유.
**이유**: 실측(B-10 사례: 동일 U에 반폭 스위치 2대 좌우 병렬 장착)에서 전폭 단일 모델이 실물을 표현 못해 강제 오배치 기록이 발생. L/R 2분할이 현장 랙 실장도 표기 관행과 일치하며 스키마 변경이 최소.
**대안**: 슬롯 분수 모델(1/2U 등 수치 폭) — 표현력은 높으나 검증·UI 복잡도 급증, 현장 수요는 좌/우 2분할로 충분.
**트레이드오프**: 3분할 이상(1/3폭 등) 미표현. 발생 시 재평가(2차).

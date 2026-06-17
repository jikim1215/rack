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

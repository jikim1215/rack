# 프로젝트: 정보시스템 자산관리 솔루션 (rack-asset-manager)

## 기술 스택
- Next.js 15 (App Router, Server Components + Client Components)
- TypeScript strict mode
- SQLite (better-sqlite3) — 단일 파일 DB, 별도 서버 불필요
- Tailwind CSS 4 — 빌드 시 번들링, 외부 CDN 미사용
- Lucide React — 아이콘 (npm 번들)
- xlsx (SheetJS) — 엑셀 처리
- qrcode — QR코드 생성

## 아키텍처 규칙
- CRITICAL: 폐쇄망 전용. 외부 CDN, API, 폰트, 텔레메트리 등 일체의 외부 네트워크 요청 금지
- CRITICAL: 모든 API 로직은 `src/app/api/` 라우트 핸들러에서만 처리. 클라이언트에서 직접 DB 접근 금지
- CRITICAL: DB 접근은 반드시 `import { getDb } from "@/lib/db"` 사용
- CRITICAL: Next.js 15 App Router의 params는 Promise — `{ params }: { params: Promise<{ id: string }> }` → `const { id } = await params;`
- Server Components 기본, 인터랙션이 필요한 곳만 `"use client"` Client Component
- 외부 npm 패키지 추가 시 폐쇄망 설치 부담 고려 — 최소화 원칙
- 인증: HMAC-SHA256 서명 쿠키 세션, Node.js crypto 내장 사용, 외부 auth 라이브러리 금지

## 개발 프로세스
- 커밋 메시지: conventional commits (feat:, fix:, docs:, refactor:, chore:)
- 기능 구현 후 반드시 `npm run build` 검증
- 기존 라우트/기능을 깨뜨리지 말 것

## 명령어
```
npm run dev       # 개발 서버 (http://localhost:3000)
npm run build     # 프로덕션 빌드
npm run start     # 프로덕션 서버
npm run db:seed   # 시드 데이터 생성 (DB 초기화)
```

## 계정 (시드 기본값)
- admin / admin123 (관리자)
- user / user123 (사용자)
- viewer / viewer123 (열람자)

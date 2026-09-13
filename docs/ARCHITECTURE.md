# 시스템 아키텍처 (ARCHITECTURE)

본 문서는 **정보시스템 자산관리 (asset-inventory)** 의 소프트웨어 아키텍처, 디렉터리 구조, 데이터 흐름, DB 설계 및 UI 디자인 표준을 정의하는 정본 문서입니다.

---

## 1. 디렉토리 구조 및 레이어링

```
src/
├── app/                    # Next.js App Router (페이지 + API 라우트)
│   ├── page.tsx            # 대시보드 (자산/실장/포트 현황, 현행화율, 생명주기)
│   ├── assets/             # 자산관리 (AssetTable.tsx, 자산 대장 및 폼)
│   ├── racks/              # 랙 실장도 (RackView.tsx, 42U 그리드, L/R 반폭)
│   ├── portmap/            # 포트맵 (PortMapView.tsx, 포트 상태 및 연결)
│   ├── distribution/       # 배선관리 (DistributionView.tsx, MDF/TPS 110블록)
│   ├── locations/          # 위치/랙 관리 (LocationManager.tsx)
│   ├── unassigned/         # 미배정 큐 (총괄 관리자 부서별 자산 일괄 배정)
│   ├── subassets/          # 부속자산 관리
│   ├── maintenance/        # 유지보수/장애 관리
│   ├── movements/          # 반입/반출 워크플로
│   ├── inspection/         # 자산실사(재물조사)
│   ├── contracts/          # 계약 및 벤더 관리
│   ├── feedback/           # 개선의견/불편사항 취합
│   ├── logs/               # 접속기록 및 감사로그 조회 (CSV 내보내기)
│   ├── settings/           # 사용자/권한/메일 설정/2단계 인증
│   ├── change-password/    # 비밀번호 변경 (취약 비번/초기화 강제 유입)
│   ├── access-denied/      # 권한 부족 안내
│   └── api/
│       ├── health/         # 시스템 헬스체크 (/api/health)
│       ├── auth/           # 인증 (login, logout, me, mfa, password)
│       ├── assets/         # 자산 CRUD + 일괄등록/내보내기/현행확인/재배정
│       ├── audit/          # 감사로그 조회 및 CSV 내보내기 (/api/audit/export)
│       ├── users/          # 사용자 CRUD + MFA 해제 + 비번 초기화
│       ├── frames/         # 배선반/페어 CRUD
│       ├── racks/          # 랙 CRUD
│       ├── locations/      # 위치 CRUD
│       ├── custom-fields/  # 커스텀 필드 CRUD
│       ├── uploads/        # 파일 서빙
│       └── analyze-image/  # AI 분석 어댑터
├── components/
│   ├── Sidebar.tsx         # 사이드바 네비게이션
│   ├── LayoutShell.tsx     # 조건부 레이아웃 (로그인 시 사이드바 제거)
│   ├── UsageGuide.tsx      # 화면별 접이식 사용법 패널
│   └── Toast.tsx           # 전역 토스트 알림
└── lib/
    ├── db.ts               # SQLite 연결, 스키마, WAL 모드, 마이그레이션
    ├── db-types.ts         # TypeScript 행 타입 정의
    ├── auth.ts             # HMAC 세션, 패스워드 scrypt 해싱
    ├── auth-core.ts        # 세션 토큰 검증 및 쿠키 관리
    ├── authz.ts            # RBAC 메뉴 권한 및 team_id 데이터 스코프 (scopeWhere)
    ├── api-authz.ts        # API 라우트 인가 래퍼 (withApi, getActor)
    ├── audit.ts            # Append-only 감사로그 기록 (logAudit, logAssetChange)
    ├── totp.ts             # TOTP 2단계 인증 (RFC 6238, 노드 내장 crypto)
    ├── qr.ts               # SVG QR 코드 생성기 (ISO 18004, 패키지 0)
    ├── asset-reassign.ts   # 미배정 자산 팀 일괄 배정 로직
    ├── menus.ts            # 메뉴 권한 레지스트리 정본
    ├── validation/         # 입력 검증 (input.ts, asset-rules.ts, upload.ts)
    └── analyzers/          # 이미지 분석 어댑터 (types, manual, index)
```

---

## 2. 디자인 패턴 및 데이터 흐름

### 2.1 아키텍처 패턴
- **Server Components 기본**: 데이터 조회가 필요한 모든 페이지는 SC에서 DB를 직접 조작 후 Client Component(`"use client"`)로 전달합니다.
- **RESTful API Route Handler**: 데이터 수정/생성/삭제 및 클라이언트 fetch 요청은 `src/app/api/` 라우트 핸들러에서 처리합니다.
- **withApi 래퍼 & default-deny 인가**: 모든 API 라우트는 `withApi`로 감싸여 exception/error를 표준 형식으로 자동 응답하며, 첫 줄에서 `getActor()`와 `assertMenuAccess/Write/Approve` 또는 `assertAdmin`으로 접근을 검증합니다.
- **Append-only Audit Logging**: 모든 자산 및 주요 설정 변경은 `logAudit` / `logAssetChange`를 통해 DB 감사로그 테이블(`audit_logs`)에 기록되며, DB 트리거로 UPDATE가 차단됩니다.

### 2.2 데이터 흐름
```
[클라이언트 브라우저]
       │
       ├─ (페이지 이동) ──▶ [Server Component (SC)] ──▶ [getDb()] ──▶ [SQLite (data.db)]
       │                                                                  │
       ├─ (상태 수정 API) ──▶ [fetch /api/*]                              │
       │                          │                                       │
       │                          ▼                                       │
       │                    [withApi 래퍼]                                │
       │                          │                                       │
       │                          ▼                                       │
       │               [assertMenuAccess / scopeWhere]                    │
       │                          │                                       │
       │                          ▼                                       │
       │                  [Route Handler] ────────────────────────────────┘
```

### 2.3 상태 관리
- **서버 상태**: Server Components (DB 직접 조회).
- **클라이언트 상태**: React `useState` / `useReducer` (폼 입력, 테이블 필터, 모달 토글, 토스트).
- **인증 세션 상태**: `httpOnly`, `SameSite=Strict`, `Secure`(HTTPS 시) 세션 쿠키 (`asset_session`). 매 요청 `token_version` 대조로 즉시 무효화 지원.

---

## 3. 데이터베이스 (SQLite Engine & WAL Architecture)

### 3.1 테이블 구조
| 테이블 | 용도 | 비고 |
|--------|------|------|
| `users` | 사용자 계정, 역할(admin/team/viewer), team_id, token_version, MFA | 비밀번호 scrypt 해시 |
| `teams` | 부서/팀 조직 정의 | 부서별 데이터 격리 기준 |
| `locations` | 위치 (건물/층/실) | 랙 소속 |
| `racks` | 랙 (위치 소속, U 단위) | total_units, width_type |
| `assets` | 자산 대장 (서버/네트워크/보안/기타, 랙 배치, verified_at 현행 확인) | team_id 단일 소유권, rack_side(L/R) |
| `asset_ips` | 자산별 다중 IP (공인/사설/VIP) | IPAM 연동 |
| `asset_photos` | 자산별 사진 첨부 | 메타데이터 및 경로 |
| `asset_logs` | 자산 변경 이력 | 개별 자산 이력 |
| `audit_logs` | 전사 감사 로그 (누가/언제/무엇을) | Append-only (트리거 차단) |
| `access_logs` | 로그인 및 접속기록 | IP, 실패사유, 1년 보존 |
| `custom_fields` / `custom_values` | 동적 커스텀 필드 정의 및 값 (EAV) | 자산 확장 속성 |
| `dist_frames` / `frame_pairs` | 배선반(MDF/TPS) 및 페어 | 팀 공용 인프라 (ADR-013) |
| `ports` | 네트워크 스위치 포트 | 포트맵 연동 |
| `menu_permissions` | 역할/메뉴별 접근·쓰기·승인 권한 매트릭스 | ADR-015 |

### 3.2 단일 파일 DB (SQLite) 설계 및 심의 Q&A

1. **왜 별도 RDBMS(Oracle/PostgreSQL)가 아닌 SQLite인가?**
   - 폐쇄망 · 단일 서버 · 동시 사용자 ~10명 · 낮은 쓰기 빈도 환경에서 SQLite는 최고의 안정성과 제로-운영 비용을 제공합니다.
   - 별도 DBMS 프로세스는 오프라인 패치, 계정/포트/네트워크 관리 대상만 늘어나는 인프라 부채가 됩니다.
2. **동시성 및 트랜잭션 보장**
   - **WAL (Write-Ahead Logging) 모드** (`PRAGMA journal_mode=WAL`): 읽기 작업이 쓰기 작업을 차단하지 않으며, 쓰기 작업 또한 읽기를 차단하지 않습니다.
   - 대량 데이터 변경(엑셀 임포트, 미배정 일괄 배정, 현행 확인)은 단일 트랜잭션으로 묶여 부분 실패 상태가 발생하지 않습니다.
3. **무결성 검사 및 백업**
   - `PRAGMA integrity_check`를 통해 언제든지 데이터 무결성을 검증합니다 (`node scripts/deploy/db-verify.mjs`).
   - 온라인 백업 API를 활용해 앱 기동 중 무중단 백업을 생성하며, 백업 및 프루닝 작업은 공용 `maintenance.lock`으로 상호 배제합니다.
4. **확장성 및 이관 대책**
   - 표준 SQL (FK, CHECK 제약, VIEW, TRIGGER)로 설계되어 향후 PostgreSQL 등 타 RDBMS로의 이관이 용이합니다.

---

## 4. UI 디자인 가이드 및 시맨틱 표준

### 4.1 디자인 원칙
1. **업무 도구 본연의 가치**: 마케팅 SaaS 랜딩 페이지가 아닌 daily admin dashboard의 정보 밀도와 시인성을 최우선으로 합니다.
2. **데이터 중심 레이아웃**: 장식적 요소를 최소화하고, 표와 그리드 중심의 데이터 시각화에 집중합니다.
3. **공공기관 표준 환경 맞춤**: 밝고 절제된 시스템 컬러 패밀리(Slate/Blue)를 적용합니다.

### 4.2 금지 스타일 (Anti-Pattern Rules)
- `backdrop-filter: blur()` (Glassmorphic 장식 금지)
- `gradient-text` (텍스트 그라데이션 금지)
- box-shadow 글로우 애니메이션 및 네온 효과 금지
- 보라/인디고 중심의 템플릿 브랜드 색상 금지
- 불필요한 레이아웃 애니메이션 금지 (간결한 `transition-colors` 호버 효과만 허용)

### 4.3 시맨틱 컬러 토큰
- **페이지 배경**: `#f8fafc` (`slate-50`)
- **패널/카드 배경**: `#ffffff` (`white`, `className="panel"`)
- **사이드바**: `#0f172a` (`slate-900`, 다크 네이비)
- **주 텍스트**: `text-ink-1` (`#0f172a`, `slate-900`)
- **본문 텍스트**: `text-ink-2` (`#334155`, `slate-700`)
- **보조 텍스트**: `text-ink-3` (`#64748b`, `slate-500`)
- **시널/주요 (Accent)**: `text-signal` / `bg-signal` (`#2563eb`, `blue-600`)
- **경고 (Warning)**: `text-warn` (`#f59e0b`, `amber-500`)
- **위험/오류 (Fault/Danger)**: `text-fault` (`#dc2626`, `red-600`)

### 4.4 컴포넌트 규약
- **버튼**: 기본 버튼 `btn`, 강조 버튼 `btn-ink`, 보조 버튼 `btn-ghost`, 위함 버튼 `btn-danger`.
- **입력 폼**: `form-input` (w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/30).
- **숫자 데이터**: `num` 클래스 적용 (우측 정렬 및 가변폭 폰트 정열).
- **아이콘**: `lucide-react` 사용 (크기 16~18px, 기본 strokeWidth 유지).
- **화면 설명**: 화면 우측 상단의 `<UsageGuide items={[...]} />` 접이식 사용법 토글 컴포넌트 표준 사용.
- **토스트 알림**: `useToast().addToast(msg, "success" | "error")` 전역 토스트 사용.

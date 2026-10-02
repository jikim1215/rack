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
- **Append-only Audit Logging**: 모든 쓰기 API 는 `logAudit` / `logAssetChange`를 통해 DB 감사로그 테이블(`audit_logs`)에 기록되며(누락은 `tests/api-route-guard.test.ts` 가 차단), DB 트리거로 UPDATE가 차단됩니다. 엔터티 종류는 `db-types.ts` 의 `AUDIT_ENTITY_TYPES` 가 단일 출처이고 DB CHECK 도 여기서 생성됩니다.

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
   - 운영 점검 쿼리는 `scripts/deploy/db-query.cjs` 가 읽기 전용(readonly + `query_only`) 연결로 수행합니다 — 폐쇄망 서버에 sqlite3 CLI 가 없어도 되고, 쓰기 SQL 은 드라이버 단에서 거부됩니다. 점검 목록은 `docs/관리자매뉴얼.md` §7.
   - 온라인 백업 API를 활용해 앱 기동 중 무중단 백업을 생성하며, 백업 및 프루닝 작업은 공용 `maintenance.lock`으로 상호 배제합니다.
4. **스키마 마이그레이션 불변식** (`src/lib/db.ts` `initSchema`, 매 기동 실행)
   - 컬럼 추가는 `ALTER TABLE … ADD COLUMN`(존재 검사). CHECK 변경처럼 ALTER 로 안 되는 것만 테이블 재생성.
   - 재생성 게이트는 **구조(컬럼 존재·CHECK 패턴)** 로 판단하고, 한 번 실행되면 다시 참이 되지 않아야 한다. (2026-10-01 이전 `assets` 게이트는 DDL 문자열 `'vm'` 유무였는데, 뒤의 CHECK 해제로 항상 참이 되어 매 재시작마다 소유 팀 등이 비워졌다.)
   - 행 복사는 `copyRows()` — 양쪽에 있는 비생성 컬럼 전부를 옮기고, 새 테이블에 없는 컬럼이 남으면 **예외(기동 중단, 트랜잭션 롤백)**. 조용한 데이터 유실보다 멈추는 쪽을 택한다.
   - `tests/schema-parity.test.ts`: 시드(구 DDL)→마이그레이션 스키마 = 신규 스키마(컬럼·타입·기본값·FK·CHECK·UNIQUE·인덱스·트리거·뷰), 두 번째 기동에서 재생성되는 테이블 0, 뒤늦게 추가된 컬럼 값의 재기동 보존.
   - 과거 유실분은 감사로그(append-only)를 재생해 복구한다 — `scripts/deploy/restore-lost-fields.cjs`(업그레이드가 자동 실행).
5. **확장성 및 이관 대책**
   - 표준 SQL (FK, CHECK 제약, VIEW, TRIGGER)로 설계되어 향후 PostgreSQL 등 타 RDBMS로의 이관이 용이합니다.
6. **자산 1만 건 규모 대응** (실측: `node scripts/bench-scale.mjs 10000` 으로 운영 DB 복사본을 키운 뒤 화면·API 응답 측정, `BENCH_KEEP=<경로>` 로 키운 DB 보존)
   - 화면이 자산 전량을 내려받지 않는다. 자산 목록·미배정 큐는 서버 페이지네이션(`src/lib/asset-list.ts` `listAssets`, 정렬 동률은 `id` 보조 키로 페이지 경계 고정), 부속 자산의 상위 자산 선택은 250ms 디바운스 서버 검색(50건 상한). 클라이언트의 `/api/assets?limit=0` 호출은 0건 — 전량은 내보내기 전용(`ASSET_ALL_CAP`).
   - 미배정 큐(`/unassigned`)는 첫 페이지만 SSR 하고 다음 페이지는 `/api/assets?scope=unassigned`(총괄 전용). 선택은 페이지를 넘어 유지되고, 재배정 후엔 보던 페이지를 다시 받는다(비면 한 페이지 앞). 부서별 일괄 배정은 페이지와 무관하게 부서 집계 전량이 대상. 1만 건: 8.3MB·530ms → 117KB·45ms.
   - 대시보드 랙 위치 충돌: SQL 자기조인(후보 쌍 200만, 인덱스 무효) 대신 `src/lib/rack-overlap.ts` `findRackConflicts` — 랙별 시작 위치 정렬 스윕, 판정은 정본 `overlaps()`. 1만 건 총괄 4.4s → 0.13s, 구 SQL 과 결과 동치(308건 비교).
   - IP 대역 화면(`/ipam`): 대역 감지·대역별 IP 조회를 정렬된 IP 수치 색인 + 이진 탐색(`lowerBound`)으로. 1만 건 16.3s → 0.36s.
   - 남은 대용량 SSR(1만 건 기준 3~5MB: 토폴로지·유지관리·IP 대역·현행 확인·랙)은 화면 특성상 전량 표시(그래프·랙 실장도)라 응답 0.4초 이내로 유지되는 범위에서 둔다.

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
정본은 `src/app/globals.css` 의 `@theme` 하나다(색 이름을 컴포넌트에 직접 쓰지 않는다). 글자색 토큰은 흰 패널·표면·`slate-100`·자기 색 10~15% 틴트 배지 위에서 모두 **4.5:1 이상**, 상태색 배경 위 흰 글자도 4.5:1 이상이다 — `tests/a11y-contrast.test.ts` 가 계산으로 고정한다.
- **표면(앱 배경)**: `bg-surface` `#f4f6fb` · **패널**: `bg-panel` `#ffffff` · **헤어라인**: `border-line` `#dce3ee`
- **주 텍스트**: `text-ink` `#0b1220` · **본문/보조**: `text-ink-2` `#475569` · **캡션**: `text-ink-3` `#5e6a7d`
- **운용/정상**: `text-signal`/`bg-signal` `#0a7652` · **점검/경고**: `text-warn`/`bg-warn` `#9d5604` · **장애/만료**: `text-fault`/`bg-fault` `#b91c1c`
- **미사용/유휴**: `text-idle` `#64748b` (큰 숫자·LED 전용, 3:1 기준)
- **사이드바(KRDS)**: `krds-primary(-strong|-bg)`, `krds-gray-*` — 활성 메뉴 글자는 `text-krds-primary-strong`
- `text-warning`/`bg-success` 처럼 `@theme` 에 없는 이름은 Tailwind 가 클래스를 만들지 않아 **무색**이 된다(실제 결함이었음) — 테스트가 막는다.

### 4.4 컴포넌트 규약
- **버튼**: 기본 버튼 `btn`, 강조 버튼 `btn-ink`, 보조 버튼 `btn-ghost`, 위험 버튼 `btn-danger`.
- **입력 폼**: `form-input` (w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/30).
- **숫자 데이터**: `num` 클래스 적용 (우측 정렬 및 가변폭 폰트 정열).
- **아이콘**: `lucide-react` 사용 (크기 16~18px, 기본 strokeWidth 유지).
- **화면 설명**: 화면 우측 상단의 `<UsageGuide items={[...]} />` 접이식 사용법 토글 컴포넌트 표준 사용.
- **토스트 알림**: `useToast().addToast(msg, "success" | "error")` 전역 토스트 사용.

### 4.5 웹 접근성 (KWCAG 2.2 / WCAG 2.1 AA)
공공기관 시스템이라 접근성은 "있으면 좋은 것"이 아니라 준수 항목이다. 아래는 코드 규약이며 각 항목을 테스트가 지킨다.
- **레이블 제공** — 모든 `<input>/<select>/<textarea>` 는 접근 가능한 이름을 가진다: `<label>`/`FormField` 로 감싸거나, `htmlFor`↔`id` 로 잇거나, `aria-label`. 시각적으로만 옆에 붙은 `<label>` 은 이름이 아니다. placeholder 의 입력 예시("예: …", "000000")를 이름으로 쓰지 않는다. → `tests/a11y-form-labels.test.ts`
- **제목 제공** — 화면마다 탭 제목이 다르다(`자산관리 · 정보시스템 자산관리`). 메뉴 화면은 `export const metadata = menuTitle("키")`(사이드바 이름과 같은 정본), 그 밖은 `{ title: "…" }`, 클라이언트 page 는 폴더 `layout.tsx` 가 맡는다. 루트(대시보드)는 template 이 적용되지 않아 `absolute` 로 같은 꼴을 맞춘다. → `tests/page-titles.test.ts`
- **키보드 사용 보장** — 클릭으로 여는 기능은 키보드로도 연다. 가능하면 `<button>`, 안에 다른 버튼이 있어 버튼이 될 수 없는 카드·칸은 `{...pressable(fn, { pressed|expanded|label })}`(`src/lib/a11y.ts`: role=button·tabIndex·Enter/Space). 표 행은 행 대신 행 안의 펼치기 버튼(`aria-expanded`)을 둔다. 접고 펴는 버튼은 `aria-expanded`, 토글 버튼은 `aria-pressed`. **모달 대화상자**(`aria-modal="true"`)는 `useDialog(열림, 닫기)`(`src/lib/use-dialog.ts`)가 반환한 ref 를 루트(`role="dialog"`·파괴적 확인은 `alertdialog`, `tabIndex={-1}`)에 단다 — 열리면 안으로 초점(`initialFocus`, 삭제 확인은 "취소"), Tab/Shift+Tab 은 안에서만 순환, Esc 는 겹친 것 중 맨 위만 닫고, 닫히면 연 버튼으로 초점이 돌아간다(안쪽 `autoFocus` 가 먼저 초점을 가져가도 트리거를 기억). 비모달 팝오버·컨텍스트 메뉴는 `useEscape(열림, 닫기)`(`src/lib/use-escape.ts`)로 Esc 만. 좁은 화면(< lg) 사이드바 서랍은 닫혀 있을 때 `inert`(화면 밖에 밀린 메뉴 16개로 Tab 이 새지 않게), 햄버거로 열면 `useDialog` 모달, 메뉴로 화면을 옮기면 초점은 새 화면 본문으로. 호버로만 드러나는 버튼은 `focus-visible:opacity-100 group-focus-within:opacity-100` 을 같이 준다. → `tests/a11y-keyboard.test.ts`
- **반복 영역 건너뛰기** — 첫 Tab 에 "본문 바로가기" 링크가 나타나 사이드바를 건너 `main#main-content`(tabIndex=-1)로 간다(`LayoutShell.tsx`). → `tests/a11y-keyboard.test.ts`
- **명도 대비** — 위 4.3 토큰만 쓰면 4.5:1 이 보장된다. 반투명 글자(`text-white/60`, `opacity-70`)는 배경에 따라 대비가 무너지므로 쓰지 않는다. 장비 블록처럼 바탕색 위에 흰 글자를 얹는 색(`racks/parts/placement.ts` `typeColors`)도 흰 글자 4.5:1 이상. `ink`/`ink-2`/`ink-3` 는 **밝은 표면 전용** — 짙은 `bg-rail`/`bg-ink` 위에선 2~3:1 이라 흰 글자(`text-white`) 또는 `slate-200`(14.7:1)·`slate-400`(7.0:1)을 쓰고, 폼·목록 패널엔 `bg-rail` 대신 `bg-surface border border-line`. 글자색을 정하는 공용 클래스(`.eyebrow`·`.form-input`)는 `@layer components` 안에 둔다 — 무계층이면 덧붙인 `text-*` 유틸리티를 이겨서 소스와 화면 색이 달라진다(로그인 하단 안내가 소스상 7:1 인데 화면 3.3:1 이던 원인). → `tests/a11y-contrast.test.ts`
- **점검 방법** — 위 정적 테스트 외에 실제 렌더 점검: 20개 화면을 로그인 상태로 열어 이름 없는 컨트롤 0, 대비 미달 텍스트 0(캔버스로 oklch 포함 실제 계산), 콘솔 오류 0 을 확인했다(2026-10-01). 2026-10-02 재점검에서 로그인 화면(비로그인)과 클릭해야 열리는 설정의 팀·사용자 추가 폼이 빠져 있던 것을 찾아 고쳤고, 로그인 포함 20개 화면 대비 미달 0 을 다시 확인했다. 모달 5종(개선의견·삭제 확인·변경이력·포트 연결·페어 편집)과 390px 서랍은 키보드만으로 열기→Tab/Shift+Tab 각 15~25회 이탈 0→Esc→트리거 복귀를 브라우저로 확인(2026-10-02).


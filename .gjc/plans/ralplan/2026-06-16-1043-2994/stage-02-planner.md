# RALPLAN v3: 정보시스템 자산관리 2차 확장 (인증+멀티IP+일괄등록+배선+대시보드+사진AI)

## Summary

7개 기능을 6개 Phase로 시퀀싱. Phase 1 인증(크로스커팅) -> Phase 2 멀티IP(스키마 변경 선행) -> Phase 3 일괄등록(xlsx) -> Phase 4 배선관리 -> Phase 5 대시보드+날짜 -> Phase 6 사진+AI. 신규 22파일, 수정 10파일, npm 추가 1개(xlsx). 각 Phase 끝에 npm run build 검증점.

## Principles

1. Zero External Dependencies (최소화): xlsx 1개만 추가, 나머지 Node.js crypto + Next.js 내장만
2. Progressive Enhancement: Phase별 독립 빌드, 기존 기능 불변
3. Convention Consistency: SC->CC props, API route handler, getDb() 싱글턴 패턴 유지
4. Denormalize for Speed, Normalize for Truth: asset_ips=정규화 진실, assets.ip_address=비정규화 캐시(is_primary)
5. Adapter Over Abstraction: AI 분석은 인터페이스+어댑터만, DI 프레임워크 금지

## Decision Drivers

1. HMAC-signed cookie session: 0 deps, Edge Runtime 호환, middleware에서 DB 접근 불필요
2. 멀티IP: asset_ips 테이블 + assets.ip_address 비정규화 캐시 -> 기존 SELECT 쿼리 20+곳 변경 없음
3. xlsx 패키지: 폐쇄망에서 npm pack으로 tarball 반입 가능, 순수 JS, 런타임 외부 의존 0

## Viable Options

### 인증: Option A HMAC Cookie(선택) vs Option B Manual JWT
### 멀티IP: Option A asset_ips+캐시(선택) vs Option B asset_ips only(JOIN 20+곳 수정)
### 일괄등록: Option A xlsx/SheetJS(선택, 업계표준) vs Option B CSV(엑셀 인코딩 문제, 한글 깨짐 리스크)

---

## In Scope

- 로그인/로그아웃/세션/RBAC, users 테이블, middleware
- asset_ips 테이블, 멀티IP CRUD API+UI, 기존 ip/access_ip 마이그레이션
- 엑셀 템플릿 다운로드 + 엑셀 업로드 일괄등록 + 행/셀 단위 유효성 검증 + 결과 UI
- MDF/TPS 110블록 배선관리 UI+API
- 대시보드: 상태분포, EoS/보증만료 경고, 데이터품질
- 자산 폼 날짜필드 + EoS 상태
- 사진 업로드/조회 + AI 분석 어댑터

## Out of Scope

- 실제 OCR/LLM 구현, 사용자관리 UI, 감사로그, HTTPS, assets.ip_address 컬럼 삭제

---

## Phase 1: 로그인/사용자 인증

### 1.1 DB: users 테이블
변경: src/lib/db.ts - initSchema에 users(id, username UNIQUE, password_hash, display_name, role CHECK admin/user/viewer, must_change_pw, created_at) 추가

### 1.2 인증 라이브러리
생성: src/lib/auth.ts
- hashPassword: crypto.scryptSync + randomBytes(16) salt, 형식 salt:hash(hex)
- verifyPassword: timingSafeEqual
- createSession: userId.username.role.expiry|hmac-sha256
- verifySession: HMAC 검증+만료체크 (DB 접근 없음=middleware 호환)
- getSessionFromCookies: API route용
- SESSION_COOKIE='rack_session', TTL=24h, AUTH_SECRET=process.env.AUTH_SECRET

### 1.3 API
생성: src/app/api/auth/login/route.ts - POST: DB 조회+verifyPassword+Set-Cookie(httpOnly,path=/,sameSite=lax,maxAge=86400)
생성: src/app/api/auth/logout/route.ts - POST: 쿠키 삭제
생성: src/app/api/auth/me/route.ts - GET: 세션에서 사용자 정보

### 1.4 Middleware
생성: src/middleware.ts - matcher: /((?!login|api/auth|_next/static|_next/image|favicon.ico).*) - HMAC 검증만(Edge Runtime), 실패시 /login redirect

### 1.5 로그인 UI
생성: src/app/login/layout.tsx - Sidebar 없는 레이아웃(children만, html/body 없음)
생성: src/app/login/page.tsx - SC wrapper
생성: src/app/login/LoginForm.tsx - CC: username/password -> POST /api/auth/login -> router.push('/')

### 1.6 Sidebar 사용자 표시
변경: src/components/Sidebar.tsx - useEffect /api/auth/me -> 하단 사용자명+역할 배지+로그아웃 버튼

### 1.7 시드+환경
변경: scripts/db-seed.mjs - users 시드: admin/admin123(must_change_pw=1), user/user123, viewer/viewer123 (scryptSync 직접)
변경: .env - AUTH_SECRET 추가

검증: build 성공, /login redirect, admin 로그인/로그아웃, Sidebar 사용자 표시

---

## Phase 2: 멀티IP (asset_ips)

### 2.1 DB: asset_ips 테이블
변경: src/lib/db.ts - initSchema에 asset_ips(id, asset_id FK, ip_address, ip_type CHECK management/service/backup/vip/other, interface_name, subnet_mask, gateway, is_primary, description, created_at) + 인덱스(asset_id, ip_address)
- assets.ip_address, assets.access_ip 컬럼 유지(비정규화 캐시)

### 2.2 IP 동기화 헬퍼
변경: src/lib/db.ts에 export function syncPrimaryIp(db, assetId) 추가
- asset_ips에서 is_primary=1인 ip_address를 assets.ip_address로 UPDATE

### 2.3 IP CRUD API
생성: src/app/api/assets/[id]/ips/route.ts
- GET: asset_ips WHERE asset_id
- POST: IP 추가, is_primary=1이면 기존 primary 해제 + syncPrimaryIp
- PUT: body=배열, transaction(DELETE all + INSERT all + syncPrimaryIp)

생성: src/app/api/assets/[id]/ips/[ipId]/route.ts
- PUT: 단일 수정, primary 변경시 동기화
- DELETE: 삭제, primary였으면 남은것 중 승격 + 동기화

### 2.4 자산 API 연동
변경: src/app/api/assets/route.ts - POST 후 body.ips 있으면 asset_ips INSERT + syncPrimaryIp
변경: src/app/api/assets/[id]/route.ts - GET에 ips 배열 포함, PUT 후 body.ips 있으면 교체+동기화

### 2.5 AssetTable 멀티IP UI
변경: src/app/assets/AssetTable.tsx
- Asset 인터페이스에 ips: {id?,ip_address,ip_type,interface_name,subnet_mask,gateway,is_primary,description}[] 추가
- 폼: 기존 ip_address/access_ip 단일입력 -> IP 관리 섹션(행 추가/삭제, ip_type select, interface_name, subnet_mask, is_primary radio)
- 확장 상세: 전체 IP 목록 표시(타입,인터페이스,서브넷,게이트웨이)
- 검색: ips 배열의 ip_address도 검색 대상

변경: src/app/assets/page.tsx - assets 조회시 각 asset에 ips 배열 attach

### 2.6 랙뷰/포트맵
비정규화 캐시(assets.ip_address) 사용하므로 코드 변경 불필요 (확인만)

### 2.7 시드
변경: scripts/db-seed.mjs - asset_ips 시드:
- 웹서버-01: eth0 10.10.1.11(service,primary), iDRAC 192.168.1.11(management), eth1 10.10.2.11(backup)
- DB서버-01: eth0 10.10.1.21(service,primary), iLO 192.168.1.21(management), eth1 10.10.2.21(backup)
- 코어스위치: mgmt0 10.10.0.1(management,primary), lo0 10.10.0.254(vip)
- 방화벽: mgmt 10.10.0.100(management,primary), eth1 10.10.100.1(service), eth2 10.10.200.1(service)
- 기타 장비: 현실적 멀티IP, TPS 스위치는 단일IP 유지

검증: build 성공, 멀티IP 입력/표시, 목록 primary IP 정상, IP CRUD

---

## Phase 3: 자산 일괄등록 (엑셀)

### 3.1 xlsx 패키지 추가
변경: package.json - dependencies에 xlsx 추가
- 폐쇄망 설치: npm pack xlsx -> tarball 반입 -> npm install ./xlsx-x.x.x.tgz
- 또는 @e965/xlsx (npm registry에서 직접 설치 가능한 커뮤니티 포크, 순수JS)
- 실행: npm install xlsx (온라인) 또는 tarball (폐쇄망)

### 3.2 템플릿 다운로드 API
생성: src/app/api/assets/template/route.ts
- GET: xlsx로 워크북 생성
- 헤더행: 유형(asset_type), 이름(name), 제조사(manufacturer), 모델(model), 시리얼(serial_number), IP주소(ip_address), 자산태그(asset_tag), 상태(status), OS(os), 관리자(admin_name), 부서(department), 랙이름(rack_name), 시작U(rack_unit_start), 크기U(rack_unit_size), 구매일(purchase_date), 보증만료일(warranty_date), EoS일(eos_date), 설명(description)
- 예시행 1개: server, 예시서버-01, Dell, PowerEdge R740, SRV-0001, 10.10.1.100, SV-100, active, Rocky Linux 9, 홍길동, 정보운영과, A-01, 1, 2, 2024-01-01, 2029-01-01, 2031-12-31, 테스트 서버
- 각 컬럼에 주석(comment)으로 입력 가이드 (유효값 목록 등)
- 응답: Content-Type application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, Content-Disposition attachment
- 셀 스타일: 헤더 볼드+배경색, 컬럼 너비 자동조정

### 3.3 일괄등록 API
생성: src/app/api/assets/import/route.ts
- POST multipart: req.formData() -> file 추출 -> xlsx.read(buffer) -> sheet_to_json
- 유효성 검증 (행별):
  - 필수값: name(빈값 불가), asset_type(빈값 불가)
  - asset_type: server/network/security/storage/other 이외면 오류
  - status: active/inactive/maintenance/decommissioned/eos 이외면 오류 (빈값이면 active 기본)
  - rack_unit_start, rack_unit_size: 숫자 아니면 오류
  - rack_name: 비어있지 않으면 DB에서 racks 테이블 조회, 없으면 오류 (존재하는 랙 이름 목록 제시)
  - 날짜 필드: 비어있으면 OK, 값 있으면 YYYY-MM-DD 형식 검증
- 오류 응답: { success: false, errors: [{row: 2, column: 'asset_type', value: 'svr', error: '유형은 server/network/security/storage/other 중 하나여야 합니다'}], totalRows: N, errorCount: N }
- 성공 응답: { success: true, imported: N, totalRows: N }
- 오류 없는 행만 INSERT (부분 성공 허용) vs 전체 실패 -> 부분 성공 방식 채택
  - 응답에 imported(성공건수) + errors(실패건수+상세) 모두 포함
- INSERT는 transaction으로 묶어 성능 확보 (100+행 대응)
- rack_name -> rack_id 변환: racks 테이블에서 name으로 조회

### 3.4 일괄등록 UI
변경: src/app/assets/AssetTable.tsx (또는 별도 BulkImportModal.tsx CC 분리 권장)
- 자산관리 페이지 상단에 '일괄등록' 버튼 추가 (Upload 아이콘, lucide-react)
- 클릭시 모달:
  1. 안내 텍스트 + '양식 다운로드' 버튼 (GET /api/assets/template -> 파일 다운로드)
  2. 파일 업로드 영역 (input[type=file] accept=.xlsx,.xls)
  3. 업로드 버튼 -> POST /api/assets/import (FormData)
  4. 결과 표시:
     - 성공: '총 N건 중 M건 등록 완료' (초록 배지)
     - 오류: 테이블로 {행, 컬럼, 입력값, 오류메시지} 표시 (빨강 배경)
     - 성공+오류 혼합: 둘 다 표시
  5. 완료 후 자산 목록 새로고침 (fetch /api/assets -> setAssets)
- 모달 닫기/재시도 가능

검증: build 성공, 템플릿 다운로드 -> 엑셀 열기 확인, 정상 데이터 업로드 -> 자산 등록, 오류 데이터 업로드 -> 행별 오류 표시

---

## Phase 4: MDF/TPS 110블록 배선관리

### 4.1 배선반 API
생성: src/app/api/frames/route.ts - GET(목록+location join), POST(배선반+페어 자동생성 transaction)
생성: src/app/api/frames/[id]/route.ts - GET(상세+페어), PUT, DELETE
생성: src/app/api/frames/[id]/pairs/route.ts - GET(페어목록), PUT(일괄수정)
생성: src/app/api/frames/[id]/pairs/[pairId]/route.ts - PUT(단일 페어 수정)

### 4.2 배선관리 UI
생성: src/app/distribution/page.tsx - SC: locations+frames 조회
생성: src/app/distribution/DistributionView.tsx - CC:
- 좌측 트리: 건물->층 (building/floor 그룹)
- 우측: 선택 위치의 110블록, 선택시 50페어 그리드(used=파랑,unused=회색,reserved=노랑,faulty=빨강)
- 페어 클릭 -> 편집(label/source/destination/cable_id/user_info/status)
- 배선반 CRUD, 검색

### 4.3 Sidebar
변경: src/components/Sidebar.tsx - nav에 배선관리(GitBranch 아이콘) 추가

### 4.4 시드
변경: scripts/db-seed.mjs - MDF 110블록 3개(외선/내선/데이터, 각 50페어) + 각 TPS실 110블록 1개(25페어) + 현실적 페어 데이터

검증: build 성공, /distribution 트리->블록->그리드, 페어 편집, 배선반 CRUD

---

## Phase 5: 대시보드 확장 + 날짜필드 + EoS

### 5.1 대시보드 통계
변경: src/app/page.tsx - getStats() 확장:
- byStatus: 상태별 자산수(active/inactive/maintenance/decommissioned/eos)
- eosWarnings: eos_date 과거~90일이내 자산목록
- warrantyWarnings: warranty_date 동일
- dataQuality: {noIp,noAdmin,noRack,noOs} 각 건수
- statusLabels에 eos:'EoS(단종)' 추가

### 5.2 대시보드 UI 3패널
변경: src/app/page.tsx:
1. 상태분포 바: CSS 수평누적바, 상태별 색상+비율
2. EoS/보증만료 경고: AlertTriangle, 자산명, 날짜, D-day 배지
3. 데이터품질 카드: 4항목 건수+비율

### 5.3 자산 폼 날짜
변경: src/app/assets/AssetTable.tsx:
- Asset+emptyAsset에 purchase_date/warranty_date/eos_date 추가
- statusLabels에 eos:'EoS(단종)' 추가
- 폼에 date 입력 3개, startEdit 복원, 확장상세에 날짜 표시

### 5.4 자산 API 날짜
변경: src/app/api/assets/route.ts - POST에 purchase_date/warranty_date/eos_date
변경: src/app/api/assets/[id]/route.ts - PUT에 purchase_date/warranty_date/eos_date

검증: build, 대시보드 3패널, 날짜 입력/표시, EoS 상태

---

## Phase 6: 사진 업로드 + AI 분석

### 6.1 업로드 API
생성: src/app/api/assets/[id]/photos/route.ts - GET(목록), POST(formData+UUID파일명+uploads/저장+DB), DELETE(파일+DB)

### 6.2 서빙 API
생성: src/app/api/uploads/[filename]/route.ts - GET: path traversal 방지 + readFileSync + Content-Type

### 6.3 사진 UI
변경(또는 별도 PhotoGallery.tsx): AssetTable 확장상세에 썸네일갤러리+업로드+모달원본+삭제

### 6.4 어댑터
생성: src/lib/analyzers/types.ts - ImageAnalyzer 인터페이스, AnalysisResult 타입
생성: src/lib/analyzers/manual.ts - ManualAnalyzer(no-op)
생성: src/lib/analyzers/index.ts - getAnalyzer(): IMAGE_ANALYZER env 기반 선택, 미구현시 manual fallback

### 6.5 분석 API
생성: src/app/api/analyze-image/route.ts - POST: photoId -> getAnalyzer().analyze()

### 6.6 환경+디렉토리
변경: .env - IMAGE_ANALYZER=manual
변경: .gitignore - uploads/
생성: uploads/.gitkeep

검증: build, 업로드->썸네일->원본, /api/analyze-image -> manual 결과

---

## File-Level Change Summary

신규 생성 (24 files):
- Phase 1: src/lib/auth.ts, src/middleware.ts, src/app/api/auth/login/route.ts, src/app/api/auth/logout/route.ts, src/app/api/auth/me/route.ts, src/app/login/layout.tsx, src/app/login/page.tsx, src/app/login/LoginForm.tsx
- Phase 2: src/app/api/assets/[id]/ips/route.ts, src/app/api/assets/[id]/ips/[ipId]/route.ts
- Phase 3: src/app/api/assets/template/route.ts, src/app/api/assets/import/route.ts, src/app/assets/BulkImportModal.tsx
- Phase 4: src/app/api/frames/route.ts, src/app/api/frames/[id]/route.ts, src/app/api/frames/[id]/pairs/route.ts, src/app/api/frames/[id]/pairs/[pairId]/route.ts, src/app/distribution/page.tsx, src/app/distribution/DistributionView.tsx
- Phase 6: src/app/api/assets/[id]/photos/route.ts, src/app/api/uploads/[filename]/route.ts, src/lib/analyzers/types.ts, src/lib/analyzers/manual.ts, src/lib/analyzers/index.ts, src/app/api/analyze-image/route.ts

수정 (10 files):
- src/lib/db.ts (Phase 1,2)
- src/components/Sidebar.tsx (Phase 1,4)
- src/app/api/assets/route.ts (Phase 2,3,5)
- src/app/api/assets/[id]/route.ts (Phase 2,5)
- src/app/assets/AssetTable.tsx (Phase 2,3,5,6)
- src/app/assets/page.tsx (Phase 2)
- src/app/page.tsx (Phase 5)
- scripts/db-seed.mjs (Phase 1,2,4)
- .env (Phase 1,6)
- .gitignore (Phase 6)
- package.json (Phase 3: xlsx 추가)

---

## Sequencing

Phase 1(인증) -> Phase 2(멀티IP) -> Phase 3(일괄등록) -> Phase 4(배선) -> Phase 5(대시보드+날짜) -> Phase 6(사진+AI)

순서 근거:
- P1 최우선: 모든 페이지 보호 선행
- P2 선행: asset_ips 스키마가 P3 템플릿 컬럼 설계와 P5 데이터품질에 영향
- P3은 P2 후: 템플릿에 멀티IP 포함 여부 결정 (v1은 primary IP만, 향후 확장)
- P4 독립: 배선은 자산과 거의 독립
- P5는 P2 후: dataQuality에서 IP 미입력 판정 기준이 asset_ips 기반
- P6 마지막: AssetTable 최종 수정, 사진 기능은 독립적

Phase 3-6은 서로 독립적이나 AssetTable.tsx 공유로 3->5->6 순서 권장.

---

## Risks and Mitigations

1. middleware에서 better-sqlite3 import -> Edge Runtime crash
   완화: auth.ts에서 middleware용(HMAC only)과 API용(DB OK) 함수 분리

2. asset_ips <-> assets.ip_address 동기화 누락
   완화: syncPrimaryIp 단일 헬퍼, 모든 IP 변경 경로에서 호출

3. xlsx 패키지 폐쇄망 설치 어려움
   완화: npm pack xlsx로 tarball 생성 -> 반입 -> npm install ./xlsx-x.x.x.tgz, 또는 @e965/xlsx(npm에서 직접 설치 가능한 포크)

4. 엑셀 일괄등록 대량행 성능
   완화: INSERT를 transaction으로 묶음, 1000행 이하 권장 제한

5. login/layout.tsx root layout 충돌
   완화: login/layout.tsx에 html/body 없이 children만, 필요시 root에서 ConditionalSidebar

6. AssetTable.tsx 비대화 (현재 594줄 -> 900줄+)
   완화: BulkImportModal.tsx, PhotoGallery.tsx를 별도 CC로 분리

7. SheetJS npm 레지스트리 버전 구식
   완화: CDN tarball(https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz) 또는 @e965/xlsx 포크 사용

---

## Handoff

- Phase 1: 단일 executor (인증은 일관된 단위)
- Phase 2: 단일 executor (IP 동기화 로직 일관성)
- Phase 3: 단일 executor (템플릿+import+UI 한 묶음)
- Phase 4: 독립 executor (배선은 독립적)
- Phase 5+6: 하나의 executor 순차 (AssetTable 공유)
- 전체: ultragoal 6 goals, 각 빌드 검증을 checkpoint

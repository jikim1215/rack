# 아키텍처

## 디렉토리 구조
```
src/
├── app/                    # 페이지 + API 라우트 (App Router)
│   ├── page.tsx            # 대시보드
│   ├── assets/             # 자산관리 (AssetTable.tsx)
│   ├── racks/              # 랙 실장도 (RackView.tsx)
│   ├── portmap/            # 포트맵 (PortMapView.tsx)
│   ├── distribution/       # 배선관리 (DistributionView.tsx)
│   ├── locations/          # 위치/랙 관리 (LocationManager.tsx)
│   ├── login/              # 로그인 (LoginForm.tsx)
│   └── api/
│       ├── auth/           # 인증 (login, logout, me)
│       ├── assets/         # 자산 CRUD + 일괄등록/내보내기
│       ├── frames/         # 배선반/페어 CRUD
│       ├── racks/          # 랙 CRUD
│       ├── locations/      # 위치 CRUD
│       ├── custom-fields/  # 커스텀 필드 CRUD
│       ├── uploads/        # 파일 서빙
│       └── analyze-image/  # AI 분석 어댑터
├── components/
│   ├── Sidebar.tsx         # 사이드바 네비게이션
│   └── LayoutShell.tsx     # 조건부 레이아웃 (로그인 시 사이드바 제거)
└── lib/
    ├── db.ts               # SQLite 연결, 스키마, 마이그레이션
    ├── auth.ts             # 인증 (HMAC 세션, 패스워드 해싱)
    ├── audit.ts            # 변경 이력 기록
    └── analyzers/          # 이미지 분석 어댑터 (types, manual, index)
```

## 패턴
- Server Components 기본, 인터랙션 필요 시 Client Component ("use client")
- 페이지 SC에서 DB 조회 → props로 CC에 전달
- API Route Handler: RESTful CRUD, DB 직접 접근
- 인증: HMAC-SHA256 서명 쿠키, Edge Runtime 미들웨어 검증
- 이미지 분석: 어댑터 패턴 (.env 설정으로 전환)

## 데이터 흐름
```
[사용자] → [Client Component] → [fetch /api/*] → [Route Handler] → [SQLite] → 응답 → UI 업데이트
                                                                      ↑
[Server Component] ─────────── [getDb()] ──────────────────────────────┘
```

## 상태 관리
- 서버 상태: Server Components (DB 직접 조회)
- 클라이언트 상태: useState (폼, 필터, 모달 토글)
- 인증 상태: httpOnly 쿠키 (서버 검증) + Sidebar useEffect 조회

## 데이터베이스 (SQLite)
| 테이블 | 용도 |
|--------|------|
| users | 사용자 인증 |
| locations | 위치 (건물/층/실) |
| racks | 랙 (위치 소속, U 단위) |
| assets | 자산 (유형, 기본정보, 운영정보, 랙 배치) |
| asset_ips | 자산별 다중 IP |
| asset_photos | 자산별 사진 |
| asset_logs | 자산 변경 이력 |
| custom_fields | 커스텀 필드 정의 |
| custom_values | 커스텀 필드 값 (EAV) |
| dist_frames | 배선반 (MDF/TPS 110블록 등) |
| frame_pairs | 배선반 페어 (회선 단위) |
| ports | 네트워크 포트 |

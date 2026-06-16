# RALPLAN v4 FINAL: 정보시스템 자산관리 2차 확장 (10 features, 7 phases)

## Summary
10개 기능을 7개 Phase로 시퀀싱. npm 추가 2개(xlsx, qrcode). 신규 31파일, 수정 11파일.
P1 인증 -> P2 멀티IP -> P3 일괄등록+내보내기 -> P4 배선관리 -> P5 대시보드+날짜+생명주기 -> P6 사진+AI -> P7 변경이력+QR코드.

## Principles
1. Zero Ext Deps (최소화): xlsx+qrcode만, 나머지 Node.js crypto+Next.js 내장
2. Progressive Enhancement: Phase별 독립 빌드
3. Convention Consistency: SC->CC props, API route handler, getDb() 싱글턴
4. Denormalize for Speed: asset_ips=진실, assets.ip_address=비정규화 캐시
5. Audit by Default: P7 이후 모든 자산 변경 자동 기록

## Decision Drivers
1. HMAC cookie: 0 deps, Edge Runtime, middleware에서 DB 불필요
2. asset_ips+캐시: 기존 SELECT 20+곳 변경 없음
3. xlsx: 템플릿+import+export 공유, 순수JS
4. qrcode: toDataURL, 순수JS, canvas optional
5. asset_logs+JSON diff: 쿼리 간단, 유연

## Options
인증: HMAC Cookie(선택) vs Manual JWT
멀티IP: asset_ips+캐시(선택) vs JOIN only
일괄등록: xlsx(선택) vs CSV
QR: qrcode npm(선택) vs qrcode-svg
이력: asset_logs+JSON(선택) vs SQLite trigger

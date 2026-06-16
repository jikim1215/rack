## Sequencing
P1(인증)->P2(멀티IP)->P3(일괄등록+내보내기)->P4(배선)->P5(대시보드+날짜+생명주기)->P6(사진+AI)->P7(이력+QR)
근거: P1 크로스커팅(changedBy), P2 스키마선행(IP컬럼확정), P3 xlsx설치(내보내기 공유), P4 독립, P5 데이터완성후, P6 사진, P7 마지막(모든API완성후 audit)
병렬가능: P4+P5 독립, P6+P7 독립. 직렬필수: AssetTable.tsx P2->P3->P5->P6->P7

## Risks
1. middleware better-sqlite3 Edge crash -> auth.ts HMAC-only 분리
2. asset_ips sync 누락 -> syncPrimaryIp 단일헬퍼
3. xlsx 폐쇄망 -> tarball 반입
4. qrcode canvas dep -> Node.js에서 optional, toDataURL 가능
5. AssetTable 비대 -> BulkImportModal/PhotoGallery/QRLabelModal 별도CC
6. audit 성능 -> INSERT만, 미미
7. login layout 충돌 -> children만 래핑
8. 엑셀 대량행 -> transaction + 1000행 권장

## Acceptance Criteria
AC1: /login 미인증 redirect, admin 로그인
AC2: /distribution 110블록 시각화, 페어 CRUD
AC3: 대시보드 상태분포+생명주기+EoS경고+데이터품질
AC4: 자산 날짜입력 + EoS상태
AC5: 사진 업로드+조회
AC6: /api/analyze-image 어댑터 패턴
AC7: 멀티IP CRUD(타입/인터페이스/서브넷)
AC8: 엑셀 템플릿다운+업로드+행별오류
AC9: 자산/랙/포트 엑셀 내보내기
AC10: 변경이력 타임라인
AC11: QR라벨 생성+인쇄
AC12: npm run build 성공

## Handoff
P1: 단일executor(인증 일관). P2: 단일executor(IP동기화). P3: 단일executor(xlsx). P4: 독립executor(배선). P5: 단일executor(대시보드). P6+P7: 순차 또는 별도CC분리로 병렬. 전체: ultragoal 7goals, 각 빌드 checkpoint

## Phase 3: 엑셀 일괄등록 + 내보내기

3.1 package.json - xlsx 추가 (폐쇄망: npm pack tarball 또는 SheetJS CDN tarball)
3.2 템플릿API - 생성 src/app/api/assets/template/route.ts: GET -> xlsx워크북, 헤더18열(유형/이름/제조사/모델/시리얼/IP/태그/상태/OS/관리자/부서/랙이름/시작U/크기U/구매일/보증만료/EoS/설명), 예시1행, 컬럼너비, Content-Disposition attachment
3.3 일괄등록API - 생성 src/app/api/assets/import/route.ts: POST formData -> xlsx.read -> sheet_to_json -> 행별검증: name필수, asset_type유효값(server/network/security/storage/other), status유효값(빈값=active), rack_unit 숫자, rack_name DB존재확인, 날짜 YYYY-MM-DD. 부분성공: 오류없는행만 INSERT(transaction). 응답: {success,imported,totalRows,errors:[{row,column,value,error}]}
3.4 내보내기API - 생성 src/app/api/assets/export/route.ts: GET ?type=assets(기본)/racks/ports -> xlsx 워크북 -> attachment. assets: JOIN racks+locations 전컬럼. racks: 랙명/위치/총U/사용U/사용률. ports: 장비/포트번호/포트명/유형/속도/상태/VLAN
3.5 일괄등록UI - 생성 src/app/assets/BulkImportModal.tsx(CC): 안내+양식다운로드(a href)+파일선택(.xlsx)+업로드+결과(성공N건/오류테이블{행/컬럼/값/오류}). AssetTable에 일괄등록버튼(Upload아이콘)+내보내기버튼(Download아이콘) 추가
검증: build, 템플릿다운->엑셀확인, 정상업로드->등록, 오류업로드->행별오류, 내보내기->엑셀

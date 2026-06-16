## Phase 4: MDF/TPS 110블록 배선관리

4.1 배선반API - 생성 src/app/api/frames/route.ts: GET(JOIN locations, ORDER building/floor), POST(transaction: INSERT dist_frames + INSERT frame_pairs 1..total_pairs). 생성 [id]/route.ts: GET(frame+pairs), PUT, DELETE(CASCADE). 생성 [id]/pairs/route.ts: GET(pairs), PUT(배열 일괄UPDATE). 생성 [id]/pairs/[pairId]/route.ts: PUT(단일pair 수정)
4.2 배선관리UI - 생성 src/app/distribution/page.tsx(SC: DISTINCT building/floor + frames JOIN locations). 생성 DistributionView.tsx(CC): 좌측250px 트리(건물->층 그룹핑, 선택하이라이트), 우측상단 배선반카드(이름/유형/사용률바, CRUD폼), 우측하단 페어그리드(5x10 또는 10x5, 색상: used=blue/unused=gray/reserved=amber/faulty=red, 클릭->인라인편집: status/label/source/destination/cable_id/user_info, 호버->툴팁), 검색(케이블ID/사용자/소스/목적지)
4.3 Sidebar - 변경: import GitBranch, nav에 {href:'/distribution', label:'배선관리', icon:GitBranch}
4.4 시드 - MDF(loc1): 외선110블록(50p, 20used/5reserved/25unused), 내선110블록(50p, 30used/5reserved), 데이터110블록(50p, 15used/5reserved). 각TPS: 110블록1개(25p, 랜덤8-18used, 1-2reserved). used페어에 현실적 label/source/destination/cable_id
검증: build, /distribution 트리->블록->그리드, 페어편집->저장, 배선반CRUD

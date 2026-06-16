## Phase 7: 변경이력 + QR코드

7.1 DB asset_logs - src/lib/db.ts: asset_logs(id, asset_id INTEGER, asset_name TEXT 스냅샷, action CHECK create/update/delete, changed_by TEXT, changed_fields TEXT JSON배열, old_values TEXT JSON, new_values TEXT JSON, created_at) + idx(asset_id, created_at). FK 없음(삭제 자산도 유지)
7.2 audit헬퍼 - 생성 src/lib/audit.ts: logAssetChange(db, {assetId,assetName,action,changedBy,oldData?,newData?}): create->전체필드기록, update->diff(old,new)->변경필드만, delete->old기록
7.3 자산API audit삽입 - assets/route.ts POST: logAssetChange(create,changedBy=세션username). assets/[id]/route.ts PUT: SELECT old -> UPDATE -> logAssetChange(update). DELETE: SELECT old -> DELETE -> logAssetChange(delete)
7.4 이력API - 생성 src/app/api/assets/[id]/logs/route.ts: GET -> SELECT asset_logs WHERE asset_id ORDER created_at DESC LIMIT 50, JSON parse changed_fields/old_values/new_values
7.5 이력UI - AssetTable 확장상세에 변경이력 섹션: fetch logs, 타임라인(시간/사용자/액션아이콘(Plus=등록,Pencil=수정,Trash2=삭제)/변경필드배지, 수정시 old->new diff)
7.6 qrcode - package.json에 qrcode 추가
7.7 QR API - 생성 src/app/api/assets/[id]/qrcode/route.ts: GET -> asset조회 -> QRCode.toDataURL(JSON.stringify({id,asset_tag,name,type,serial}), {width:256}) -> {qrDataUrl,asset_tag,name}. ?format=svg -> toString
7.8 QR라벨UI - 생성 src/app/assets/QRLabelModal.tsx(CC): QR이미지(128x128)+자산태그/이름/시리얼/관리자, @media print CSS, window.print(). AssetTable: QrCode아이콘 버튼 추가, 일괄QR인쇄(체크박스선택->2x4그리드)
검증: build, 자산수정->이력기록, 이력타임라인, QR생성->스캔, 인쇄미리보기

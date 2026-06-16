## Phase 2: 멀티IP (asset_ips)

2.1 DB - src/lib/db.ts: asset_ips(id, asset_id FK CASCADE, ip_address NOT NULL, ip_type CHECK management/service/backup/vip/other DEFAULT service, interface_name, subnet_mask, gateway, is_primary INTEGER DEFAULT 0, description, created_at) + indexes. assets.ip_address/access_ip 유지(캐시). export syncPrimaryIp(db,assetId): is_primary=1 IP -> assets.ip_address UPDATE
2.2 IP API - 생성 src/app/api/assets/[id]/ips/route.ts: GET(목록), POST(추가+primary동기화), PUT(배열 일괄교체 transaction). 생성 [id]/ips/[ipId]/route.ts: PUT(단일수정), DELETE(삭제+primary승격)
2.3 자산API연동 - assets/route.ts POST: body.ips있으면 INSERT+sync, 없으면 body.ip_address로 하위호환. assets/[id]/route.ts GET: ips배열 포함, PUT: body.ips 교체+sync
2.4 AssetTable - ips:AssetIp[] 추가, 폼에 IP관리 섹션(행추가/삭제, ip_type select, interface_name, subnet_mask, is_primary radio), 확장상세에 전체IP목록, 검색에 ips 포함
2.5 page.tsx - SC에서 asset_ips 그룹핑 후 props
2.6 랙뷰/포트맵 - 변경 불필요(비정규화캐시)
2.7 시드 - 웹서버: eth0(service,primary)+iDRAC(mgmt)+eth1(backup). DB서버: eth0+iLO+eth1. 코어스위치: Vlan1(mgmt,primary)+Lo0(vip). 방화벽: mgmt(primary)+eth1/1(service외부)+eth1/2(service내부). SAN: mgmt(primary)+iscsi0+iscsi1. TPS:단일IP
검증: build, 멀티IP CRUD, 목록 primary, 확장 전체IP

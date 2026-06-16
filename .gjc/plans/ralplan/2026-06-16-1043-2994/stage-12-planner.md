## File-Level Change Summary

### 신규 31 files
P1(8): src/lib/auth.ts, src/middleware.ts, src/app/api/auth/login/route.ts, api/auth/logout/route.ts, api/auth/me/route.ts, src/app/login/layout.tsx, login/page.tsx, login/LoginForm.tsx
P2(2): src/app/api/assets/[id]/ips/route.ts, [id]/ips/[ipId]/route.ts
P3(4): api/assets/template/route.ts, api/assets/import/route.ts, api/assets/export/route.ts, src/app/assets/BulkImportModal.tsx
P4(6): api/frames/route.ts, api/frames/[id]/route.ts, api/frames/[id]/pairs/route.ts, api/frames/[id]/pairs/[pairId]/route.ts, src/app/distribution/page.tsx, distribution/DistributionView.tsx
P6(7): api/assets/[id]/photos/route.ts, api/uploads/[filename]/route.ts, src/app/assets/PhotoGallery.tsx, src/lib/analyzers/types.ts, analyzers/manual.ts, analyzers/index.ts, api/analyze-image/route.ts
P7(4): src/lib/audit.ts, api/assets/[id]/logs/route.ts, api/assets/[id]/qrcode/route.ts, src/app/assets/QRLabelModal.tsx

### 수정 11 files
src/lib/db.ts (P1:users, P2:asset_ips+sync, P7:asset_logs)
src/components/Sidebar.tsx (P1:사용자+로그아웃, P4:배선메뉴)
src/app/api/assets/route.ts (P2:ips, P5:날짜, P7:audit)
src/app/api/assets/[id]/route.ts (P2:ips+GET, P5:날짜, P7:audit)
src/app/assets/AssetTable.tsx (P2:멀티IP, P3:일괄등록/내보내기, P5:날짜+EoS, P6:PhotoGallery, P7:이력+QR)
src/app/assets/page.tsx (P2:ips attach)
src/app/page.tsx (P5:4패널)
scripts/db-seed.mjs (P1:users, P2:asset_ips, P4:frames+pairs)
package.json (P3:xlsx, P7:qrcode)
.env (P1:AUTH_SECRET, P6:IMAGE_ANALYZER)
.gitignore (P6:uploads/)

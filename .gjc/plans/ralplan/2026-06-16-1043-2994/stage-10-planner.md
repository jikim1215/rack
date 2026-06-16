## Phase 6: 사진 업로드 + AI 분석

6.1 업로드API - 생성 src/app/api/assets/[id]/photos/route.ts: GET(asset_photos WHERE asset_id), POST(formData->mime검증jpeg/png/webp->size<=10MB->randomUUID+ext->mkdirSync uploads->writeFileSync->INSERT), DELETE(?photoId->unlinkSync+DELETE)
6.2 서빙API - 생성 src/app/api/uploads/[filename]/route.ts: GET(path.basename검증, /..방지->readFileSync->Content-Type)
6.3 사진UI - 생성 src/app/assets/PhotoGallery.tsx(CC): assetId prop, useEffect fetch photos, 4열 썸네일그리드(80x80 object-fit:cover), 클릭->모달원본, 업로드(input file+FormData POST), 삭제(X버튼). AssetTable 확장상세에 PhotoGallery 추가
6.4 어댑터 - 생성 src/lib/analyzers/types.ts(ImageAnalyzer interface, AnalysisResult), manual.ts(ManualAnalyzer: success:true,description:'수동 분석 필요'), index.ts(getAnalyzer: env IMAGE_ANALYZER -> manual/tesseract/ollama, 미구현->manual fallback)
6.5 분석API - 생성 src/app/api/analyze-image/route.ts: POST {photoId} -> DB filename -> getAnalyzer().analyze(filepath) -> {analyzer,result}
6.6 환경 - .env: IMAGE_ANALYZER=manual, .gitignore: uploads/, uploads/.gitkeep
검증: build, 업로드->썸네일->원본, 삭제, analyze-image->manual, 미구현어댑터->fallback

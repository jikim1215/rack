import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertAdmin } from "@/lib/authz";
import { rollbackPreview, rollbackBatch } from "@/lib/import-rollback";
import { asBody, str, ValidationError } from "@/lib/validation/input";

// ── 임포트 배치 롤백 (외부 검토 R6-1 합의) ──
// 핵심 로직은 src/lib/import-rollback.ts (단위테스트 대상). 이 라우트는 인가·검증·위임만 한다.
// - admin 전용 (대량 파괴 작업)
// - preview: 삭제 예상량 분해(생성/수정/연결/이슈)만 반환 — confirm 표시용 (2차 R1-3 합의)
// - 실행: 생성분 전량 삭제 + 자산별 delete 감사 + 배치 open 이슈 자동 정리 (2차 R1-4 합의)
// - import_issue 행은 증적으로 보존 (asset_id FK는 SET NULL로 자동 해소)
export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertAdmin(actor);

  const body = asBody(await readJson(req));
  const batchId = str(body, "batch_id", { required: true, label: "batch_id" });
  if (!/^up-\d+$/.test(batchId)) {
    throw new ValidationError("유효한 batch_id가 필요합니다. (형식: up-<timestamp>)");
  }

  const db = getDb();

  if (body.preview) {
    const pv = rollbackPreview(db, batchId);
    if (!pv) return NextResponse.json({ error: "해당 배치로 생성된 자산이 없습니다. (이미 롤백했거나 잘못된 batch_id)" }, { status: 404 });
    return NextResponse.json({ preview: true, batch_id: batchId, ...pv });
  }

  const deleted = rollbackBatch(db, batchId, actor.username);
  if (deleted === 0) {
    return NextResponse.json({ error: "해당 배치로 생성된 자산이 없습니다. (이미 롤백했거나 잘못된 batch_id)" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, deleted, batch_id: batchId });
});

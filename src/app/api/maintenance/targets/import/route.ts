import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readFormData } from "@/lib/api-authz";
import { assertUploadSize } from "@/lib/validation/upload";
import { assertMenuWrite, assertCanWrite, AuthzError, scopeWhere } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { parseTargetWorkbook, TARGET_INSERT_COLUMNS } from "@/lib/maintenance-target-import";

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "maintenance");
  assertCanWrite(actor);

  const actorName = actor.username;
  const formData = await readFormData(req);
  const file = formData.get("file") as File | null;
  const replace = String(formData.get("replace") || "") === "1";
  // 전체 교체(replace)는 테이블을 통째로 비운다. maintenance_targets 는 team_id 가 없고(소유는 asset_id 파생)
  // 미연결 행은 전 팀 공용이라 팀 범위 삭제를 정의할 수 없다 → 총괄 전용.
  if (replace && actor.role !== "admin") {
    throw new AuthzError("전체 교체 가져오기는 총괄 관리자만 할 수 있습니다.", 403);
  }
  assertUploadSize(file);
  // 매직바이트·압축 폭탄·파싱 실패·행 상한 → 400 (lib/xlsx-upload.ts)
  const { targets, skipped } = await parseTargetWorkbook(Buffer.from(await file.arrayBuffer()));
  if (targets.length === 0) {
    return NextResponse.json({ error: "가져올 유효한 행이 없습니다.", skipped }, { status: 400 });
  }

  const db = getDb();
  const cols = [...TARGET_INSERT_COLUMNS, "asset_id", "asset_name", "created_by", "updated_by"];
  const insert = db.prepare(`
    INSERT INTO maintenance_targets (${cols.join(", ")})
    VALUES (${cols.map((c) => `@${c}`).join(", ")})
  `);
  // 자산코드 → 자산 매칭(asset_tag). 있으면 asset_id/asset_name 스냅샷 연결.
  //   팀은 자기 팀 자산만 연결(타팀 자산명 노출·교차 연결 차단). 범위 밖 코드는 미연결로 등록.
  const scope = scopeWhere(actor, "team_id");
  const findAsset = db.prepare(`SELECT id, asset_name FROM assets WHERE asset_tag = ? AND asset_tag != '' AND ${scope.sql}`);

  let inserted = 0;
  const tx = db.transaction(() => {
    if (replace) db.exec("DELETE FROM maintenance_targets");
    for (const t of targets) {
      const matched = t.asset_code ? (findAsset.get(t.asset_code, ...scope.params) as { id: number; asset_name: string } | undefined) : undefined;
      insert.run({
        ...t,
        asset_id: matched ? matched.id : null,
        asset_name: matched ? matched.asset_name : "",
        created_by: actorName,
        updated_by: actorName,
      });
      inserted++;
    }
  });
  tx();

  logAudit(db, {
    entityType: "maintenance",
    entityId: null,
    entityName: "유지관리 대상 가져오기",
    action: "create",
    changedBy: actorName,
    newData: { event: "target_import", inserted, skipped, replaced: replace },
  });

  return NextResponse.json({ ok: true, inserted, skipped, replaced: replace });
});

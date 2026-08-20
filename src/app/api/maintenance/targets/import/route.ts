import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanWrite } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { isXlsxBuffer } from "@/lib/validation/asset-rules";
import { parseTargetWorkbook, TARGET_INSERT_COLUMNS } from "@/lib/maintenance-target-import";

export async function POST(req: NextRequest) {
  const actor = await getActor();
  try {
    assertCanWrite(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const actorName = actor?.username || "system";
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const replace = String(formData.get("replace") || "") === "1";
  if (!file) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!isXlsxBuffer(buffer)) {
    return NextResponse.json({ error: "유효한 .xlsx 파일이 아닙니다 (매직바이트 불일치)." }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseTargetWorkbook(buffer);
  } catch {
    return NextResponse.json({ error: "엑셀 파싱에 실패했습니다." }, { status: 400 });
  }
  const { targets, skipped } = parsed;
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
  const findAsset = db.prepare("SELECT id, asset_name FROM assets WHERE asset_tag = ? AND asset_tag != ''");

  let inserted = 0;
  const tx = db.transaction(() => {
    if (replace) db.exec("DELETE FROM maintenance_targets");
    for (const t of targets) {
      const matched = t.asset_code ? (findAsset.get(t.asset_code) as { id: number; asset_name: string } | undefined) : undefined;
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
}

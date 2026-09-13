import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActor, withApi } from "@/lib/api-authz";
import { assertMenuWrite, assertCanWrite, scopeWhere } from "@/lib/authz";
import { pathId } from "@/lib/validation/input";
import { logAssetChange } from "@/lib/audit";
import type { AssetRow } from "@/lib/db-types";

type Ctx = { params: Promise<{ id: string }> };

// ── 현행 확인 도장 (단건) ──
// "값을 바꾸지 않았어도 사람이 봤고 맞다" 를 기록한다. updated_at 은 건드리지 않는다(값 변경 아님).
// 스코프: 목록과 같은 scopeWhere — 타팀 자산은 404 로 은닉(존재 노출 방지).
export const POST = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "assets");
  const id = pathId((await params).id);
  const db = getDb();

  const scope = scopeWhere(actor, "team_id");
  const asset = db.prepare(`SELECT id, asset_name, team_id, verified_at FROM assets WHERE id = ? AND ${scope.sql}`)
    .get(id, ...scope.params) as Pick<AssetRow, "id" | "asset_name" | "team_id" | "verified_at"> | undefined;
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });
  assertCanWrite(actor, asset.team_id ?? null);

  const { now } = db.prepare("SELECT datetime('now','localtime') AS now").get() as { now: string };
  db.prepare("UPDATE assets SET verified_at = ?, verified_by = ? WHERE id = ?").run(now, actor.username, asset.id);
  logAssetChange(db, {
    assetId: asset.id, assetName: asset.asset_name, action: "update", changedBy: actor.username,
    oldData: { verified_at: asset.verified_at },
    newData: { verified_at: now, verified_by: actor.username, _cause: "현행 확인" },
  });
  return NextResponse.json({ ok: true, verified_at: now, verified_by: actor.username });
});

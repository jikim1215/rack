import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuWrite, assertCanWrite, scopeWhere } from "@/lib/authz";
import { asBody, ValidationError } from "@/lib/validation/input";
import { logAssetChange } from "@/lib/audit";
import type { AssetRow } from "@/lib/db-types";

const MAX_BULK = 500;

// ── 현행 확인 도장 (일괄) — 목록에서 선택한 자산을 한 번에 ──
// 스코프 밖(타팀) 자산은 조용히 건너뛰고 skipped 로 센다. 건별 감사로그.
export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "assets");
  const b = asBody(await readJson(req));
  const raw = Array.isArray(b.asset_ids) ? (b.asset_ids as unknown[]) : null;
  if (!raw || raw.length === 0) throw new ValidationError("확인할 자산을 선택하세요.");
  if (raw.length > MAX_BULK) throw new ValidationError(`한 번에 최대 ${MAX_BULK}건까지 확인할 수 있습니다.`);
  const ids = [...new Set(raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) throw new ValidationError("올바른 자산 ID 가 없습니다.");

  const db = getDb();
  const scope = scopeWhere(actor, "team_id");
  const targets = db.prepare(
    `SELECT id, asset_name, team_id, verified_at FROM assets WHERE id IN (${ids.map(() => "?").join(",")}) AND ${scope.sql}`,
  ).all(...ids, ...scope.params) as Pick<AssetRow, "id" | "asset_name" | "team_id" | "verified_at">[];
  // 쓰기 권한(viewer 거부 등) — 첫 건으로 역할 검증, 팀 소유는 scope 가 이미 보장
  if (targets.length > 0) assertCanWrite(actor, targets[0].team_id ?? null);

  const { now } = db.prepare("SELECT datetime('now','localtime') AS now").get() as { now: string };
  const upd = db.prepare("UPDATE assets SET verified_at = ?, verified_by = ? WHERE id = ?");
  db.transaction(() => {
    for (const a of targets) {
      upd.run(now, actor.username, a.id);
      logAssetChange(db, {
        assetId: a.id, assetName: a.asset_name, action: "update", changedBy: actor.username,
        oldData: { verified_at: a.verified_at },
        newData: { verified_at: now, verified_by: actor.username, _cause: "현행 확인(일괄)" },
      });
    }
  })();
  return NextResponse.json({ ok: true, verified: targets.length, skipped: ids.length - targets.length, verified_at: now });
});

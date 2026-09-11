import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi } from "@/lib/api-authz";
import { assertMenuAccess } from "@/lib/authz";
import { pathId } from "@/lib/validation/input";
import type { AssetRow, AuditLogRow, CountRow } from "@/lib/db-types";

export const GET = withApi(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const actor = await getActor();
  assertMenuAccess(actor, "assets");
  const id = pathId((await params).id);
  const db = getDb();

  // 자산의 소유 팀을 먼저 확인하여 assets/[id] GET과 동일한 팀 가시성 적용
  const asset = db.prepare("SELECT team_id FROM assets WHERE id = ?").get(id) as Pick<AssetRow, "team_id"> | undefined;
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const visible =
    actor.role === "admin" ||
    actor.role === "viewer" ||
    (actor.teamId != null && (asset.team_id ?? null) === actor.teamId);
  // 타팀 자산은 존재 노출 방지를 위해 404
  if (!visible) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 페이지네이션 (외부 검토 R4-1 합의): 오래된 변경 맥락도 '더 보기'로 추적 가능하게
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 20, 100);
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset")) || 0, 0);
  const total = (
    db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE entity_type = 'asset' AND entity_id = ?").get(id) as CountRow
  ).c;
  const logs = db
    .prepare(
      "SELECT * FROM audit_logs WHERE entity_type = 'asset' AND entity_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
    )
    .all(id, limit, offset) as AuditLogRow[];

  const parsed = logs.map((log) => ({
    ...log,
    changed_fields: safeJsonParse(log.changed_fields, []),
    old_values: safeJsonParse(log.old_values, {}),
    new_values: safeJsonParse(log.new_values, {}),
  }));

  return NextResponse.json({ rows: parsed, total });
});

function safeJsonParse(str: string, fallback: unknown): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

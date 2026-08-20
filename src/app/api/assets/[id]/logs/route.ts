import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead } from "@/lib/authz";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getActor();
  try {
    assertCanRead(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }
  const { id } = await params;
  const db = getDb();

  // 자산의 소유 팀을 먼저 확인하여 assets/[id] GET과 동일한 팀 가시성 적용
  const asset = db.prepare("SELECT team_id FROM assets WHERE id = ?").get(Number(id)) as any;
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const visible =
    actor!.role === "admin" ||
    actor!.role === "viewer" ||
    (actor!.teamId != null && (asset.team_id ?? null) === actor!.teamId);
  // 타팀 자산은 존재 노출 방지를 위해 404
  if (!visible) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 페이지네이션 (외부 검토 R4-1 합의): 오래된 변경 맥락도 '더 보기'로 추적 가능하게
  const limit = Math.min(Number(_req.nextUrl.searchParams.get('limit')) || 20, 100);
  const offset = Math.max(Number(_req.nextUrl.searchParams.get('offset')) || 0, 0);
  const total = (db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE entity_type = 'asset' AND entity_id = ?").get(Number(id)) as { c: number }).c;
  const logs = db.prepare(
    "SELECT * FROM audit_logs WHERE entity_type = 'asset' AND entity_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
  ).all(Number(id), limit, offset) as any[];

  const parsed = logs.map((log) => ({
    ...log,
    changed_fields: safeJsonParse(log.changed_fields, []),
    old_values: safeJsonParse(log.old_values, {}),
    new_values: safeJsonParse(log.new_values, {}),
  }));

  return NextResponse.json({ rows: parsed, total });
}

function safeJsonParse(str: string, fallback: any): any {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

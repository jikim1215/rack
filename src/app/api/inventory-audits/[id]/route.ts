import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertAdmin } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

interface AuditRow {
  id: number;
  audit_name: string;
  status: "open" | "closed";
  started_at: string;
  closed_at: string;
  created_by: string;
  description: string;
}

// 회차 마감(closed_at 기록) — 총괄(admin) 전용.
export async function PUT(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const db = getDb();

  const audit = db.prepare("SELECT * FROM inventory_audits WHERE id = ?").get(Number(id)) as AuditRow | undefined;
  if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    assertAdmin(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  if (audit.status === "closed") {
    return NextResponse.json({ error: "이미 마감된 회차입니다." }, { status: 400 });
  }

  // 마감 스냅샷(비평 합의 R3-2): 대상 집합은 조회 시점 유동이므로, 마감 시점의 전사 대상/확인 수를 고정 기록해 증빙 재현성 확보
  const totalNow =
    (db.prepare("SELECT COUNT(*) c FROM assets").get() as any).c +
    (db.prepare("SELECT COUNT(*) c FROM sub_assets WHERE status != 'disposed'").get() as any).c;
  const checkedNow = (db.prepare("SELECT COUNT(*) c FROM inventory_audit_checks WHERE audit_id = ?").get(audit.id) as any).c;
  // 스냅샷 확장 (외부 검토 R8-6 합의): 회차 단위 설명력 — 불일치(확인 외 판정) 수 + 장비/부속 확인 수
  const mismatchNow = (db.prepare("SELECT COUNT(*) c FROM inventory_audit_checks WHERE audit_id = ? AND result != 'confirmed'").get(audit.id) as any).c;
  const equipNow = (db.prepare("SELECT COUNT(*) c FROM inventory_audit_checks WHERE audit_id = ? AND asset_id IS NOT NULL").get(audit.id) as any).c;
  const subNow = (db.prepare("SELECT COUNT(*) c FROM inventory_audit_checks WHERE audit_id = ? AND sub_asset_id IS NOT NULL").get(audit.id) as any).c;
  db.prepare(`
    UPDATE inventory_audits
    SET status = 'closed', closed_at = datetime('now','localtime'),
        closed_total = ?, closed_checked = ?, closed_mismatch = ?, closed_equip_checked = ?, closed_sub_checked = ?
    WHERE id = ?
  `).run(totalNow, checkedNow, mismatchNow, equipNow, subNow, audit.id);

    logAudit(db, {
    entityType: "inventory_audit",
    entityId: audit.id,
    entityName: `자산실사: ${audit.audit_name}`,
    action: "update",
    changedBy: actor.username,
    oldData: { status: "open" },
    newData: { status: "closed" },
  });

  const updated = db.prepare("SELECT * FROM inventory_audits WHERE id = ?").get(audit.id);
  return NextResponse.json(updated);
}

// 회차 삭제 — 총괄(admin) 전용. 확인 기록은 FK CASCADE 로 함께 삭제된다.
// 단, 마감(closed) 회차는 감사 증적이므로 삭제 불가 (외부 검토 R3-1 합의: open 회차만 삭제 허용).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const db = getDb();

  const audit = db.prepare("SELECT * FROM inventory_audits WHERE id = ?").get(Number(id)) as AuditRow | undefined;
  if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    assertAdmin(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  if (audit.status === "closed") {
    return NextResponse.json(
      { error: "마감된 회차는 감사 증적 보존을 위해 삭제할 수 없습니다. (진행중 회차만 삭제 가능)" },
      { status: 400 }
    );
  }

  db.prepare("DELETE FROM inventory_audits WHERE id = ?").run(audit.id);

  logAudit(db, {
    entityType: "inventory_audit",
    entityId: audit.id,
    entityName: `자산실사: ${audit.audit_name}`,
    action: "delete",
    changedBy: actor.username,
    oldData: { audit_name: audit.audit_name, status: audit.status },
  });

  return NextResponse.json({ ok: true });
}

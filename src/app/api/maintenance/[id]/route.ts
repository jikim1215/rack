import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuWrite, assertCanWrite, assertCanDelete } from "@/lib/authz";
import { asBody, str, oneOf, idOrNull, int, pathId } from "@/lib/validation/input";
import type { MaintenanceLogRow, MaintenanceTargetRow, AssetRow } from "@/lib/db-types";

type Ctx = { params: Promise<{ id: string }> };
type Body = ReturnType<typeof asBody>;

// 대상(target) 레코드 정규화. PUT(record_kind === "target") 전용.
function normalizeTargetUpdates(b: Body, actorName: string) {
  return {
    asset_id: idOrNull(b, "asset_id", "자산"),
    system_name: str(b, "system_name"),
    category: str(b, "category"),
    asset_type_label: str(b, "asset_type_label"),
    resource_name: str(b, "resource_name"),
    quantity: int(b, "quantity", { min: 1, default: 1, label: "수량" }),
    manufacturer: str(b, "manufacturer"),
    host_name: str(b, "host_name"),
    purpose: str(b, "purpose"),
    location_text: str(b, "location_text"),
    rack_position: str(b, "rack_position"),
    asset_code: str(b, "asset_code"),
    owner_department: str(b, "owner_department"),
    owner_user: str(b, "owner_user"),
    acquisition_date: str(b, "acquisition_date"),
    acquisition_amount: str(b, "acquisition_amount"),
    maintenance_start: str(b, "maintenance_start"),
    maintenance_end: str(b, "maintenance_end"),
    maintenance_months: int(b, "maintenance_months", { min: 0, default: 0, label: "유지보수 기간" }),
    business_impact: str(b, "business_impact"),
    data_importance: str(b, "data_importance"),
    user_traffic: str(b, "user_traffic"),
    hardware_score: str(b, "hardware_score"),
    maintenance_difficulty: str(b, "maintenance_difficulty"),
    maintenance_scope: str(b, "maintenance_scope"),
    score_total: str(b, "score_total"),
    grade: str(b, "grade"),
    rate: str(b, "rate"),
    estimated_amount_calc: str(b, "estimated_amount_calc"),
    estimated_amount_input: str(b, "estimated_amount_input"),
    evidence_note: str(b, "evidence_note"),
    notes: str(b, "notes"),
    updated_by: actorName,
  };
}

function resolveOwnerTeamId(db: ReturnType<typeof getDb>, assetId: number | null) {
  if (assetId == null) return null;
  const asset = db.prepare("SELECT team_id FROM assets WHERE id = ?").get(assetId) as Pick<AssetRow, "team_id"> | undefined;
  return asset ? asset.team_id : null;
}

export const PUT = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "maintenance");
  const id = pathId((await params).id);
  const db = getDb();
  const b = asBody(await readJson(req));
  const actorName = actor.username;
  const recordKind = b.record_kind === "target" ? "target" : "log";

  if (recordKind === "target") {
    const target = db.prepare("SELECT * FROM maintenance_targets WHERE id = ?").get(id) as MaintenanceTargetRow | undefined;
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const next = normalizeTargetUpdates(b, actorName);
    const ownerTeamId = resolveOwnerTeamId(db, next.asset_id ?? target.asset_id ?? null);
    assertCanWrite(actor, ownerTeamId);

    const assetName = next.asset_id != null
      ? ((db.prepare("SELECT asset_name FROM assets WHERE id = ?").get(next.asset_id) as Pick<AssetRow, "asset_name"> | undefined)?.asset_name || "")
      : "";

    db.prepare(`
      UPDATE maintenance_targets
      SET asset_id = @asset_id,
          asset_name = @asset_name,
          system_name = @system_name,
          category = @category,
          asset_type_label = @asset_type_label,
          resource_name = @resource_name,
          quantity = @quantity,
          manufacturer = @manufacturer,
          host_name = @host_name,
          purpose = @purpose,
          location_text = @location_text,
          rack_position = @rack_position,
          asset_code = @asset_code,
          owner_department = @owner_department,
          owner_user = @owner_user,
          acquisition_date = @acquisition_date,
          acquisition_amount = @acquisition_amount,
          maintenance_start = @maintenance_start,
          maintenance_end = @maintenance_end,
          maintenance_months = @maintenance_months,
          business_impact = @business_impact,
          data_importance = @data_importance,
          user_traffic = @user_traffic,
          hardware_score = @hardware_score,
          maintenance_difficulty = @maintenance_difficulty,
          maintenance_scope = @maintenance_scope,
          score_total = @score_total,
          grade = @grade,
          rate = @rate,
          estimated_amount_calc = @estimated_amount_calc,
          estimated_amount_input = @estimated_amount_input,
          evidence_note = @evidence_note,
          notes = @notes,
          updated_by = @updated_by,
          updated_at = datetime('now','localtime')
      WHERE id = @id
    `).run({ ...next, asset_name: assetName, id });

    const updated = db.prepare(`
      SELECT mt.*, COALESCE(a.asset_name, mt.asset_name) AS asset_name
      FROM maintenance_targets mt
      LEFT JOIN assets a ON mt.asset_id = a.id
      WHERE mt.id = ?
    `).get(id) as MaintenanceTargetRow;

    logAudit(db, {
      entityType: "maintenance",
      entityId: id,
      entityName: next.resource_name || assetName || next.system_name || `유지관리 대상 #${id}`,
      action: "update",
      changedBy: actorName,
      oldData: {
        asset_id: target.asset_id,
        system_name: target.system_name,
        resource_name: target.resource_name,
        asset_code: target.asset_code,
        grade: target.grade,
        estimated_amount_input: target.estimated_amount_input,
        maintenance_scope: target.maintenance_scope,
      },
      newData: {
        asset_id: next.asset_id,
        system_name: next.system_name,
        resource_name: next.resource_name,
        asset_code: next.asset_code,
        grade: next.grade,
        estimated_amount_input: next.estimated_amount_input,
        maintenance_scope: next.maintenance_scope,
      },
    });

    return NextResponse.json(updated);
  }

  const log = db.prepare("SELECT * FROM maintenance_logs WHERE id = ?").get(id) as MaintenanceLogRow | undefined;
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ownerTeamId = resolveOwnerTeamId(db, log.asset_id ?? null);
  assertCanWrite(actor, ownerTeamId);

  const updates: string[] = [];
  const values: Record<string, unknown> = { id };
  const oldData: Record<string, unknown> = {};
  const newData: Record<string, unknown> = {};

  if (b.status !== undefined) {
    const status = oneOf(b, "status", ["open", "in_progress", "resolved"] as const, { label: "상태" });
    updates.push("status = @status");
    values.status = status;
    oldData.status = log.status;
    newData.status = status;
    if (status === "resolved") {
      updates.push("resolved_at = datetime('now','localtime')");
      oldData.resolved_at = log.resolved_at;
      newData.resolved_at = "resolved-now";
    }
    if (status === "in_progress" || status === "resolved") {
      updates.push("handled_by = @handled_by");
      values.handled_by = actor.username;
      oldData.handled_by = log.handled_by;
      newData.handled_by = actor.username;
    }
  }
  if (b.action_taken !== undefined) {
    const actionTaken = str(b, "action_taken");
    updates.push("action_taken = @action_taken");
    values.action_taken = actionTaken;
    oldData.action_taken = log.action_taken;
    newData.action_taken = actionTaken;
  }
  if (b.notes !== undefined) {
    const notes = str(b, "notes");
    updates.push("notes = @notes");
    values.notes = notes;
    oldData.notes = log.notes;
    newData.notes = notes;
  }

  if (updates.length > 0) {
    db.prepare(`UPDATE maintenance_logs SET ${updates.join(", ")} WHERE id = @id`).run(values);

    if (values.status === "in_progress" && log.log_type === "failure" && log.asset_id) {
      db.prepare("UPDATE assets SET status = ? WHERE id = ?").run("maintenance", log.asset_id);
    }

    if (values.status === "resolved" && log.log_type === "failure" && log.asset_id) {
      db.prepare("UPDATE assets SET status = ? WHERE id = ?").run("active", log.asset_id);
    }
  }

  const updatedLog = db.prepare(`
    SELECT ml.*, COALESCE(a.asset_name, ml.asset_name) AS asset_name, v.vendor_name
    FROM maintenance_logs ml
    LEFT JOIN assets a ON ml.asset_id = a.id
    LEFT JOIN vendors v ON ml.vendor_id = v.id
    WHERE ml.id = ?
  `).get(id) as (MaintenanceLogRow & { vendor_name: string | null }) | undefined;

  logAudit(db, {
    entityType: "maintenance",
    entityId: id,
    entityName: updatedLog?.asset_name || log.asset_name || `유지보수 #${id}`,
    action: "update",
    changedBy: actorName,
    oldData,
    newData,
  });

  return NextResponse.json(updatedLog);
});

export const DELETE = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "maintenance");
  const id = pathId((await params).id);
  const db = getDb();
  const url = new URL(req.url);
  const recordKind = url.searchParams.get("record_kind") === "target" ? "target" : "log";
  const actorName = actor.username;

  if (recordKind === "target") {
    const target = db.prepare("SELECT * FROM maintenance_targets WHERE id = ?").get(id) as MaintenanceTargetRow | undefined;
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const ownerTeamId = resolveOwnerTeamId(db, target.asset_id ?? null);
    assertCanDelete(actor, ownerTeamId);

    db.prepare("DELETE FROM maintenance_targets WHERE id = ?").run(id);
    logAudit(db, {
      entityType: "maintenance",
      entityId: id,
      entityName: target.resource_name || target.asset_name || target.system_name || `유지관리 대상 #${id}`,
      action: "delete",
      changedBy: actorName,
      oldData: {
        record_kind: "target",
        asset_id: target.asset_id,
        system_name: target.system_name,
        resource_name: target.resource_name,
        asset_code: target.asset_code,
        grade: target.grade,
        estimated_amount_input: target.estimated_amount_input,
      },
    });
    return NextResponse.json({ ok: true });
  }

  const log = db.prepare("SELECT * FROM maintenance_logs WHERE id = ?").get(id) as MaintenanceLogRow | undefined;
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ownerTeamId = resolveOwnerTeamId(db, log.asset_id ?? null);
  assertCanDelete(actor, ownerTeamId);

  db.prepare("DELETE FROM maintenance_logs WHERE id = ?").run(id);
  logAudit(db, {
    entityType: "maintenance",
    entityId: id,
    entityName: log.asset_name || `유지보수 #${id}`,
    action: "delete",
    changedBy: actorName,
    oldData: {
      record_kind: "log",
      asset_id: log.asset_id,
      log_type: log.log_type,
      status: log.status,
      occurred_at: log.occurred_at,
    },
  });
  return NextResponse.json({ ok: true });
});

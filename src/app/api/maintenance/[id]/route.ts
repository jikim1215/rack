import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanWrite, assertCanDelete } from "@/lib/authz";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeInteger(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeTargetUpdates(body: any, actorName: string) {
  return {
    asset_id: body.asset_id != null && body.asset_id !== "" ? Number(body.asset_id) : null,
    system_name: normalizeText(body.system_name),
    category: normalizeText(body.category),
    asset_type_label: normalizeText(body.asset_type_label),
    resource_name: normalizeText(body.resource_name),
    quantity: Math.max(1, normalizeInteger(body.quantity, 1)),
    manufacturer: normalizeText(body.manufacturer),
    host_name: normalizeText(body.host_name),
    purpose: normalizeText(body.purpose),
    location_text: normalizeText(body.location_text),
    rack_position: normalizeText(body.rack_position),
    asset_code: normalizeText(body.asset_code),
    owner_department: normalizeText(body.owner_department),
    owner_user: normalizeText(body.owner_user),
    acquisition_date: normalizeText(body.acquisition_date),
    acquisition_amount: normalizeText(body.acquisition_amount),
    maintenance_start: normalizeText(body.maintenance_start),
    maintenance_end: normalizeText(body.maintenance_end),
    maintenance_months: Math.max(0, normalizeInteger(body.maintenance_months, 0)),
    business_impact: normalizeText(body.business_impact),
    data_importance: normalizeText(body.data_importance),
    user_traffic: normalizeText(body.user_traffic),
    hardware_score: normalizeText(body.hardware_score),
    maintenance_difficulty: normalizeText(body.maintenance_difficulty),
    maintenance_scope: normalizeText(body.maintenance_scope),
    score_total: normalizeText(body.score_total),
    grade: normalizeText(body.grade),
    rate: normalizeText(body.rate),
    estimated_amount_calc: normalizeText(body.estimated_amount_calc),
    estimated_amount_input: normalizeText(body.estimated_amount_input),
    evidence_note: normalizeText(body.evidence_note),
    notes: normalizeText(body.notes),
    updated_by: actorName,
  };
}

function resolveOwnerTeamId(db: ReturnType<typeof getDb>, assetId: number | null) {
  if (assetId == null) return null;
  const asset = db.prepare("SELECT team_id FROM assets WHERE id = ?").get(assetId) as { team_id: number | null } | undefined;
  return asset ? asset.team_id : null;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  const actorName = actor?.username || "system";
  const recordKind = body.record_kind === "target" ? "target" : "log";

  if (recordKind === "target") {
    const target = db.prepare("SELECT * FROM maintenance_targets WHERE id = ?").get(Number(id)) as any;
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const next = normalizeTargetUpdates(body, actorName);
    const ownerTeamId = resolveOwnerTeamId(db, next.asset_id ?? target.asset_id ?? null);
    try {
      assertCanWrite(actor, ownerTeamId);
    } catch (e) {
      const r = authzError(e);
      if (r) return r;
      throw e;
    }

    const assetName = next.asset_id != null
      ? ((db.prepare("SELECT asset_name FROM assets WHERE id = ?").get(next.asset_id) as { asset_name?: string } | undefined)?.asset_name || "")
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
    `).run({ ...next, asset_name: assetName, id: Number(id) });

    const updated = db.prepare(`
      SELECT mt.*, COALESCE(a.asset_name, mt.asset_name) AS asset_name
      FROM maintenance_targets mt
      LEFT JOIN assets a ON mt.asset_id = a.id
      WHERE mt.id = ?
    `).get(Number(id));

    logAudit(db, {
      entityType: "maintenance",
      entityId: Number(id),
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

  const log = db.prepare("SELECT * FROM maintenance_logs WHERE id = ?").get(Number(id)) as any;
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ownerTeamId = resolveOwnerTeamId(db, log.asset_id ?? null);
  try {
    assertCanWrite(actor, ownerTeamId);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const updates: string[] = [];
  const values: any = { id: Number(id) };
  const oldData: Record<string, unknown> = {};
  const newData: Record<string, unknown> = {};

  if (body.status) {
    updates.push("status = @status");
    values.status = body.status;
    oldData.status = log.status;
    newData.status = body.status;
    if (body.status === "resolved") {
      updates.push("resolved_at = datetime('now','localtime')");
      oldData.resolved_at = log.resolved_at;
      newData.resolved_at = "resolved-now";
    }
    if (body.status === "in_progress" || body.status === "resolved") {
      updates.push("handled_by = @handled_by");
      values.handled_by = actor.username;
      oldData.handled_by = log.handled_by;
      newData.handled_by = actor.username;
    }
  }
  if (body.action_taken !== undefined) {
    updates.push("action_taken = @action_taken");
    values.action_taken = body.action_taken;
    oldData.action_taken = log.action_taken;
    newData.action_taken = body.action_taken;
  }
  if (body.notes !== undefined) {
    updates.push("notes = @notes");
    values.notes = body.notes;
    oldData.notes = log.notes;
    newData.notes = body.notes;
  }

  if (updates.length > 0) {
    db.prepare(`UPDATE maintenance_logs SET ${updates.join(", ")} WHERE id = @id`).run(values);

    if (body.status === "in_progress" && log.log_type === "failure" && log.asset_id) {
      db.prepare("UPDATE assets SET status = ? WHERE id = ?").run("maintenance", log.asset_id);
    }

    if (body.status === "resolved" && log.log_type === "failure" && log.asset_id) {
      db.prepare("UPDATE assets SET status = ? WHERE id = ?").run("active", log.asset_id);
    }
  }

  const updatedLog = db.prepare(`
    SELECT ml.*, COALESCE(a.asset_name, ml.asset_name) AS asset_name, v.vendor_name
    FROM maintenance_logs ml
    LEFT JOIN assets a ON ml.asset_id = a.id
    LEFT JOIN vendors v ON ml.vendor_id = v.id
    WHERE ml.id = ?
  `).get(Number(id)) as any;

  logAudit(db, {
    entityType: "maintenance",
    entityId: Number(id),
    entityName: updatedLog?.asset_name || log.asset_name || `유지보수 #${id}`,
    action: "update",
    changedBy: actorName,
    oldData,
    newData,
  });

  return NextResponse.json(updatedLog);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const db = getDb();
  const url = new URL(req.url);
  const recordKind = url.searchParams.get("record_kind") === "target" ? "target" : "log";
  const actorName = actor?.username || "system";

  if (recordKind === "target") {
    const target = db.prepare("SELECT * FROM maintenance_targets WHERE id = ?").get(Number(id)) as any;
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const ownerTeamId = resolveOwnerTeamId(db, target.asset_id ?? null);
    try {
      assertCanDelete(actor, ownerTeamId);
    } catch (e) {
      const r = authzError(e);
      if (r) return r;
      throw e;
    }

    db.prepare("DELETE FROM maintenance_targets WHERE id = ?").run(Number(id));
    logAudit(db, {
      entityType: "maintenance",
      entityId: Number(id),
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

  const log = db.prepare("SELECT * FROM maintenance_logs WHERE id = ?").get(Number(id)) as any;
  if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ownerTeamId = resolveOwnerTeamId(db, log.asset_id ?? null);
  try {
    assertCanDelete(actor, ownerTeamId);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  db.prepare("DELETE FROM maintenance_logs WHERE id = ?").run(Number(id));
  logAudit(db, {
    entityType: "maintenance",
    entityId: Number(id),
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
}

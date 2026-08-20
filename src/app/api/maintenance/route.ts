import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, assertCanWrite, scopeWhere } from "@/lib/authz";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeInteger(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeTargetBody(body: any, actorName: string) {
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

export async function GET() {
  const actor = await getActor();
  try {
    assertCanRead(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const db = getDb();
  const scope = scopeWhere(actor, "a.team_id");
  const logs = db.prepare(`
    SELECT ml.*, COALESCE(a.asset_name, ml.asset_name) AS asset_name, v.vendor_name
    FROM maintenance_logs ml
    LEFT JOIN assets a ON ml.asset_id = a.id
    LEFT JOIN vendors v ON ml.vendor_id = v.id
    WHERE (ml.asset_id IS NULL OR ${scope.sql})
    ORDER BY ml.created_at DESC, ml.id DESC
  `).all(...scope.params);

  const targets = db.prepare(`
    SELECT mt.*, COALESCE(a.asset_name, mt.asset_name) AS asset_name
    FROM maintenance_targets mt
    LEFT JOIN assets a ON mt.asset_id = a.id
    WHERE (mt.asset_id IS NULL OR ${scope.sql})
    ORDER BY mt.updated_at DESC, mt.id DESC
  `).all(...scope.params);

  return NextResponse.json({ logs, targets });
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  const body = await req.json();
  const db = getDb();
  const actorName = actor?.username || "system";

  if (body.record_kind === "target") {
    const payload = normalizeTargetBody(body, actorName);
    const ownerTeamId = resolveOwnerTeamId(db, payload.asset_id);
    try {
      assertCanWrite(actor, ownerTeamId);
    } catch (e) {
      const r = authzError(e);
      if (r) return r;
      throw e;
    }

    const assetName = payload.asset_id != null
      ? ((db.prepare("SELECT asset_name FROM assets WHERE id = ?").get(payload.asset_id) as { asset_name?: string } | undefined)?.asset_name || "")
      : "";

    const result = db.prepare(`
      INSERT INTO maintenance_targets (
        asset_id, asset_name, system_name, category, asset_type_label, resource_name,
        quantity, manufacturer, host_name, purpose, location_text, rack_position,
        asset_code, owner_department, owner_user, acquisition_date, acquisition_amount,
        maintenance_start, maintenance_end, maintenance_months, business_impact,
        data_importance, user_traffic, hardware_score, maintenance_difficulty,
        maintenance_scope, score_total, grade, rate, estimated_amount_calc,
        estimated_amount_input, evidence_note, notes, created_by, updated_by
      ) VALUES (
        @asset_id, @asset_name, @system_name, @category, @asset_type_label, @resource_name,
        @quantity, @manufacturer, @host_name, @purpose, @location_text, @rack_position,
        @asset_code, @owner_department, @owner_user, @acquisition_date, @acquisition_amount,
        @maintenance_start, @maintenance_end, @maintenance_months, @business_impact,
        @data_importance, @user_traffic, @hardware_score, @maintenance_difficulty,
        @maintenance_scope, @score_total, @grade, @rate, @estimated_amount_calc,
        @estimated_amount_input, @evidence_note, @notes, @created_by, @updated_by
      )
    `).run({ ...payload, asset_name: assetName, created_by: actorName });

    const created = db.prepare(`
      SELECT mt.*, COALESCE(a.asset_name, mt.asset_name) AS asset_name
      FROM maintenance_targets mt
      LEFT JOIN assets a ON mt.asset_id = a.id
      WHERE mt.id = ?
    `).get(result.lastInsertRowid);

    logAudit(db, {
      entityType: "maintenance",
      entityId: Number(result.lastInsertRowid),
      entityName: payload.resource_name || assetName || payload.system_name || `유지관리 대상 #${result.lastInsertRowid}`,
      action: "create",
      changedBy: actorName,
      newData: {
        record_kind: "target",
        asset_id: payload.asset_id,
        system_name: payload.system_name,
        resource_name: payload.resource_name,
        asset_code: payload.asset_code,
        grade: payload.grade,
        estimated_amount_input: payload.estimated_amount_input,
      },
    });

    return NextResponse.json(created, { status: 201 });
  }

  const ownerTeamId = resolveOwnerTeamId(db, body.asset_id != null ? Number(body.asset_id) : null);
  try {
    assertCanWrite(actor, ownerTeamId);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const assetName = body.asset_id != null
    ? ((db.prepare("SELECT asset_name FROM assets WHERE id = ?").get(Number(body.asset_id)) as { asset_name?: string } | undefined)?.asset_name || "")
    : "";

  const result = db.prepare(`
    INSERT INTO maintenance_logs (asset_id, asset_name, log_type, occurred_at, severity, symptom, action_taken, vendor_id, cost, notes, status, reported_by)
    VALUES (@asset_id, @asset_name, @log_type, @occurred_at, @severity, @symptom, @action_taken, @vendor_id, @cost, @notes, 'open', @reported_by)
  `).run({
    asset_id: body.asset_id,
    asset_name: assetName,
    log_type: body.log_type || "failure",
    occurred_at: body.occurred_at || "",
    severity: body.severity || "minor",
    symptom: body.symptom || "",
    action_taken: body.action_taken || "",
    vendor_id: body.vendor_id || null,
    cost: body.cost || "",
    notes: body.notes || "",
    reported_by: actorName,
  });

  if (body.log_type === "failure" && body.asset_id) {
    db.prepare("UPDATE assets SET status = ? WHERE id = ?").run("maintenance", body.asset_id);
  }

  const log = db.prepare(`
    SELECT ml.*, COALESCE(a.asset_name, ml.asset_name) AS asset_name, v.vendor_name
    FROM maintenance_logs ml
    LEFT JOIN assets a ON ml.asset_id = a.id
    LEFT JOIN vendors v ON ml.vendor_id = v.id
    WHERE ml.id = ?
  `).get(result.lastInsertRowid);

  logAudit(db, {
    entityType: "maintenance",
    entityId: Number(result.lastInsertRowid),
    entityName: assetName || `유지보수 #${result.lastInsertRowid}`,
    action: "create",
    changedBy: actorName,
    newData: {
      record_kind: "log",
      asset_id: body.asset_id,
      log_type: body.log_type || "failure",
      severity: body.severity || "minor",
      status: "open",
      occurred_at: body.occurred_at || "",
    },
  });

  return NextResponse.json(log, { status: 201 });
}

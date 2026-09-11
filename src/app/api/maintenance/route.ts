import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, scopeWhere } from "@/lib/authz";
import { asBody, str, oneOf, idOrNull, int } from "@/lib/validation/input";
import type { MaintenanceLogRow, MaintenanceTargetRow, AssetRow } from "@/lib/db-types";

type Body = ReturnType<typeof asBody>;

// 대상(target) 레코드 정규화. record_kind === "target" 인 POST/PUT 공용.
function normalizeTargetBody(b: Body, actorName: string) {
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

export const GET = withApi(async () => {
  const actor = await getActor();
  assertMenuAccess(actor, "maintenance");

  const db = getDb();
  const scope = scopeWhere(actor, "a.team_id");
  const logs = db.prepare(`
    SELECT ml.*, COALESCE(a.asset_name, ml.asset_name) AS asset_name, v.vendor_name
    FROM maintenance_logs ml
    LEFT JOIN assets a ON ml.asset_id = a.id
    LEFT JOIN vendors v ON ml.vendor_id = v.id
    WHERE (ml.asset_id IS NULL OR ${scope.sql})
    ORDER BY ml.created_at DESC, ml.id DESC
  `).all(...scope.params) as (MaintenanceLogRow & { vendor_name: string | null })[];

  const targets = db.prepare(`
    SELECT mt.*, COALESCE(a.asset_name, mt.asset_name) AS asset_name
    FROM maintenance_targets mt
    LEFT JOIN assets a ON mt.asset_id = a.id
    WHERE (mt.asset_id IS NULL OR ${scope.sql})
    ORDER BY mt.updated_at DESC, mt.id DESC
  `).all(...scope.params) as MaintenanceTargetRow[];

  return NextResponse.json({ logs, targets });
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "maintenance");
  const b = asBody(await readJson(req));
  const db = getDb();
  const actorName = actor.username;

  if (b.record_kind === "target") {
    const payload = normalizeTargetBody(b, actorName);
    const ownerTeamId = resolveOwnerTeamId(db, payload.asset_id);
    assertCanWrite(actor, ownerTeamId);

    const assetName = payload.asset_id != null
      ? ((db.prepare("SELECT asset_name FROM assets WHERE id = ?").get(payload.asset_id) as Pick<AssetRow, "asset_name"> | undefined)?.asset_name || "")
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
    `).get(result.lastInsertRowid) as MaintenanceTargetRow;

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

  const assetId = idOrNull(b, "asset_id", "자산");
  const logType = oneOf(b, "log_type", ["failure", "maintenance", "inspection"] as const, { default: "failure", label: "유형" });
  const severity = oneOf(b, "severity", ["critical", "major", "minor"] as const, { default: "minor", label: "심각도" });
  const vendorId = idOrNull(b, "vendor_id", "협력업체");
  const occurredAt = str(b, "occurred_at", { max: 30 });
  const symptom = str(b, "symptom");
  const actionTaken = str(b, "action_taken");
  const cost = str(b, "cost");
  const notes = str(b, "notes");

  const ownerTeamId = resolveOwnerTeamId(db, assetId);
  assertCanWrite(actor, ownerTeamId);

  const assetName = assetId != null
    ? ((db.prepare("SELECT asset_name FROM assets WHERE id = ?").get(assetId) as Pick<AssetRow, "asset_name"> | undefined)?.asset_name || "")
    : "";

  const result = db.prepare(`
    INSERT INTO maintenance_logs (asset_id, asset_name, log_type, occurred_at, severity, symptom, action_taken, vendor_id, cost, notes, status, reported_by)
    VALUES (@asset_id, @asset_name, @log_type, @occurred_at, @severity, @symptom, @action_taken, @vendor_id, @cost, @notes, 'open', @reported_by)
  `).run({
    asset_id: assetId,
    asset_name: assetName,
    log_type: logType,
    occurred_at: occurredAt,
    severity,
    symptom,
    action_taken: actionTaken,
    vendor_id: vendorId,
    cost,
    notes,
    reported_by: actorName,
  });

  if (logType === "failure" && assetId) {
    db.prepare("UPDATE assets SET status = ? WHERE id = ?").run("maintenance", assetId);
  }

  const log = db.prepare(`
    SELECT ml.*, COALESCE(a.asset_name, ml.asset_name) AS asset_name, v.vendor_name
    FROM maintenance_logs ml
    LEFT JOIN assets a ON ml.asset_id = a.id
    LEFT JOIN vendors v ON ml.vendor_id = v.id
    WHERE ml.id = ?
  `).get(result.lastInsertRowid) as MaintenanceLogRow & { vendor_name: string | null };

  logAudit(db, {
    entityType: "maintenance",
    entityId: Number(result.lastInsertRowid),
    entityName: assetName || `유지보수 #${result.lastInsertRowid}`,
    action: "create",
    changedBy: actorName,
    newData: {
      record_kind: "log",
      asset_id: assetId,
      log_type: logType,
      severity,
      status: "open",
      occurred_at: occurredAt,
    },
  });

  return NextResponse.json(log, { status: 201 });
});

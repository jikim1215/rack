import Database from "better-sqlite3";

type EntityType = "asset" | "rack" | "location" | "frame" | "contract" | "movement" | "maintenance";

export function logAudit(db: Database.Database, params: {
  entityType: EntityType;
  entityId: number | null;
  entityName: string;
  action: "create" | "update" | "delete";
  changedBy: string;
  oldData?: Record<string, any>;
  newData?: Record<string, any>;
}) {
  const { entityType, entityId, entityName, action, changedBy, oldData, newData } = params;
  let changedFields: string[] = [];
  let oldValues: Record<string, any> = {};
  let newValues: Record<string, any> = {};

  if (action === "create" && newData) {
    changedFields = Object.keys(newData);
    newValues = newData;
  } else if (action === "update" && oldData && newData) {
    for (const key of Object.keys(newData)) {
      if (String(oldData[key] ?? "") !== String(newData[key] ?? "")) {
        changedFields.push(key);
        oldValues[key] = oldData[key];
        newValues[key] = newData[key];
      }
    }
    if (changedFields.length === 0) return;
  } else if (action === "delete" && oldData) {
    changedFields = Object.keys(oldData);
    oldValues = oldData;
  }

  db.prepare(
    `INSERT INTO audit_logs (entity_type, entity_id, entity_name, action, changed_by, changed_fields, old_values, new_values)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(entityType, entityId, entityName, action, changedBy, JSON.stringify(changedFields), JSON.stringify(oldValues), JSON.stringify(newValues));
}

// 하위 호환 래퍼
export function logAssetChange(db: Database.Database, params: {
  assetId: number | null;
  assetName: string;
  action: "create" | "update" | "delete";
  changedBy: string;
  oldData?: Record<string, any>;
  newData?: Record<string, any>;
}) {
  logAudit(db, {
    entityType: "asset",
    entityId: params.assetId,
    entityName: params.assetName,
    action: params.action,
    changedBy: params.changedBy,
    oldData: params.oldData,
    newData: params.newData,
  });
}

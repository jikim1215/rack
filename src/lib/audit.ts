import Database from "better-sqlite3";
import type { AuditEntityType, AuditAction } from "./db-types";

export type { AuditEntityType as EntityType };

type Values = Record<string, unknown>;
// 행 인터페이스(AssetRow 등)도 그대로 넘길 수 있게 느슨하게 받는다.
type AnyRecord = object;

// 감사로그에 남기면 안 되는 민감 컴럼 — 계정 변경 로그(entity 'user')에서 해시/토큰이 old/new 값으로 샐는 것을 막는다.
const REDACTED_KEYS = new Set(["password_hash", "password", "token_version"]);
function redact(v: AnyRecord | undefined): Values | undefined {
  if (!v) return undefined;
  const out: Values = {};
  for (const [k, val] of Object.entries(v as Values)) out[k] = REDACTED_KEYS.has(k) ? "[redacted]" : val;
  return out;
}

export function logAudit(db: Database.Database, params: {
  entityType: AuditEntityType;
  entityId: number | null;
  entityName: string;
  action: AuditAction;
  changedBy: string;
  oldData?: AnyRecord;
  newData?: AnyRecord;
}) {
  const { entityType, entityId, entityName, action, changedBy } = params;
  const oldData = redact(params.oldData);
  const newData = redact(params.newData);
  let changedFields: string[] = [];
  let oldValues: Values = {};
  let newValues: Values = {};

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
  oldData?: AnyRecord;
  newData?: AnyRecord;
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

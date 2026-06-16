import Database from 'better-sqlite3';

export function logAssetChange(db: Database.Database, params: {
  assetId: number | null;
  assetName: string;
  action: 'create' | 'update' | 'delete';
  changedBy: string;
  oldData?: Record<string, any>;
  newData?: Record<string, any>;
}) {
  const { assetId, assetName, action, changedBy, oldData, newData } = params;
  let changedFields: string[] = [];
  let oldValues: Record<string, any> = {};
  let newValues: Record<string, any> = {};

  if (action === 'create' && newData) {
    changedFields = Object.keys(newData);
    newValues = newData;
  } else if (action === 'update' && oldData && newData) {
    for (const key of Object.keys(newData)) {
      if (String(oldData[key] ?? '') !== String(newData[key] ?? '')) {
        changedFields.push(key);
        oldValues[key] = oldData[key];
        newValues[key] = newData[key];
      }
    }
    if (changedFields.length === 0) return; // 변경 없음
  } else if (action === 'delete' && oldData) {
    changedFields = Object.keys(oldData);
    oldValues = oldData;
  }

  db.prepare(`INSERT INTO asset_logs (asset_id, asset_name, action, changed_by, changed_fields, old_values, new_values) VALUES (?,?,?,?,?,?,?)`)
    .run(assetId, assetName, action, changedBy, JSON.stringify(changedFields), JSON.stringify(oldValues), JSON.stringify(newValues));
}

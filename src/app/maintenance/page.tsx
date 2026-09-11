export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { requireMenuPage } from "@/lib/page-authz";
import { scopeWhere } from "@/lib/authz";
import MaintenanceView from "./MaintenanceView";
import type { MaintenanceLogRow, MaintenanceTargetRow, AssetRow, VendorRow } from "@/lib/db-types";

export default async function MaintenancePage() {
  const db = getDb();
  const actor = await requireMenuPage("maintenance"); // 메뉴 접근 게이트(P1): 권한 없으면 /access-denied

  const scope = scopeWhere(actor, "a.team_id");
  const logs = db.prepare(`
    SELECT ml.*, COALESCE(a.asset_name, ml.asset_name) AS asset_name, v.vendor_name
    FROM maintenance_logs ml
    LEFT JOIN assets a ON ml.asset_id = a.id
    LEFT JOIN vendors v ON ml.vendor_id = v.id
    WHERE (ml.asset_id IS NULL OR ${scope.sql})
    ORDER BY ml.created_at DESC, ml.id DESC
  `).all(...scope.params) as (MaintenanceLogRow & { asset_name: string | null; vendor_name: string | null })[];

  const targets = db.prepare(`
    SELECT mt.*, COALESCE(a.asset_name, mt.asset_name) AS asset_name
    FROM maintenance_targets mt
    LEFT JOIN assets a ON mt.asset_id = a.id
    WHERE (mt.asset_id IS NULL OR ${scope.sql})
    ORDER BY mt.updated_at DESC, mt.id DESC
  `).all(...scope.params) as (MaintenanceTargetRow & { asset_name: string | null })[];

  const assetsScope = scopeWhere(actor, "team_id");
  const assets = db.prepare(`
    SELECT id, asset_name, asset_tag, manufacturer, model, team_id
    FROM assets
    WHERE ${assetsScope.sql}
    ORDER BY asset_name
  `).all(...assetsScope.params) as Pick<AssetRow, "id" | "asset_name" | "asset_tag" | "manufacturer" | "model" | "team_id">[];
  const vendors = db.prepare(`SELECT id, vendor_name FROM vendors ORDER BY vendor_name`).all() as Pick<VendorRow, "id" | "vendor_name">[];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="eyebrow">MAINT</div>
          <h2 className="text-2xl font-bold tracking-tight">유지보수</h2>
          <p className="text-sm text-ink-3 mt-1">장애·유지보수·점검 이력과 <strong className="text-ink-2">유지관리 대상/금액 산정 기록</strong>을 함께 관리합니다.</p>
        </div>
      </div>
      <MaintenanceView logs={logs} targets={targets} assets={assets} vendors={vendors} />
    </div>
  );
}

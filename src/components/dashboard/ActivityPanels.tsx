// ── 하단 활동 패널: 반입/반출, 유지보수/장애, 계약 만료 임박, 최근 등록 자산 ──
import { ArrowLeftRight, FileText, Wrench, CheckCircle } from "lucide-react";
import Panel from "./Panel";
import { movementLabels, movementColors, severityLabels, severityColors, typeLabels, typeColors, statusLabels } from "./labels";
import type { MovementRow, MaintenanceLogRow, ContractRow, AssetRow } from "@/lib/db-types";

export function MovementsPanel({
  pendingMovements, recentMovements,
}: {
  pendingMovements: number;
  recentMovements: (MovementRow & { asset_name: string | null })[];
}) {
  return (
    <Panel
      title="반입/반출"
      code="I/O"
      icon={<ArrowLeftRight size={16} className="text-ink-2" />}
    >
      <p className="eyebrow mb-3">대기 승인 <span className="num text-base font-bold text-ink ml-1">{pendingMovements}</span> 건</p>
      {recentMovements.length > 0 ? (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {recentMovements.map((m, i) => (
            <div key={m.id ?? i} className="flex items-center justify-between text-sm border-b border-line last:border-0 pb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="num text-xs text-ink-3 shrink-0">{(m.created_at || '').slice(0, 10)}</span>
                <span className={`text-xs font-medium ${movementColors[m.movement_type] || 'text-ink-2'}`}>
                  {movementLabels[m.movement_type] || m.movement_type}
                </span>
                <span className="truncate">{m.asset_name || '-'}</span>
              </div>
              <span className="eyebrow shrink-0 ml-2 !text-[0.625rem]">{m.status}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-ink-3 text-sm">내역 없음</p>
      )}
    </Panel>
  );
}

export function MaintenancePanel({
  openMaintenance, recentMaintenance,
}: {
  openMaintenance: number;
  recentMaintenance: (MaintenanceLogRow & { asset_name: string | null })[];
}) {
  return (
    <Panel
      title="유지보수/장애"
      code="MAINT"
      icon={<Wrench size={16} className="text-warn" />}
    >
      <p className="eyebrow mb-3">미해결 <span className="num text-base font-bold text-warn ml-1">{openMaintenance}</span> 건</p>
      {recentMaintenance.length > 0 ? (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {recentMaintenance.map((ml, i) => (
            <div key={ml.id ?? i} className="flex items-center justify-between text-sm border-b border-line last:border-0 pb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="num text-xs text-ink-3 shrink-0">{(ml.created_at || '').slice(0, 10)}</span>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${severityColors[ml.severity] || ''}`}>
                  {severityLabels[ml.severity] || ml.severity || '-'}
                </span>
                <span className="truncate">{ml.asset_name || '-'}</span>
              </div>
              <span className="eyebrow shrink-0 ml-2 !text-[0.625rem]">{ml.status}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-ink-3 text-sm">내역 없음</p>
      )}
    </Panel>
  );
}

export function ContractsPanel({
  expiringContracts, today,
}: {
  expiringContracts: (ContractRow & { vendor_name: string | null })[];
  today: string;
}) {
  return (
    <Panel
      title="계약 만료 임박"
      code="SLA"
      icon={<FileText size={16} className="text-fault" />}
    >
      {expiringContracts.length > 0 ? (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {expiringContracts.map((c, i) => {
            const d = Math.ceil((new Date(c.end_date).getTime() - new Date(today).getTime()) / 86400000);
            return (
              <div key={c.id ?? i} className="flex items-center justify-between text-sm border-b border-line last:border-0 pb-1.5">
                <div className="min-w-0">
                  <span className="font-medium truncate block">{c.contract_name || '-'}</span>
                  <span className="text-xs text-ink-3">{c.vendor_name || '-'} · <span className="num">{c.end_date}</span></span>
                </div>
                <span className={`num text-xs px-1.5 py-0.5 rounded font-semibold shrink-0 ml-2 ${d <= 30 ? 'bg-red-50 text-fault' : 'bg-amber-50 text-warn'}`}>
                  {d <= 0 ? '만료' : `D-${d}`}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-signal text-sm">
          <CheckCircle size={16} />
          만료 임박 계약 없음
        </div>
      )}
    </Panel>
  );
}

export function RecentAssetsPanel({
  recentAssets,
}: {
  recentAssets: Pick<AssetRow, "id" | "asset_name" | "asset_type" | "status" | "ip_address" | "os" | "admin_name" | "department">[];
}) {
  return (
    <Panel title="최근 등록 자산" code="RECENT">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="pb-2 eyebrow font-normal">이름</th>
            <th className="pb-2 eyebrow font-normal">유형</th>
            <th className="pb-2 eyebrow font-normal">IP</th>
            <th className="pb-2 eyebrow font-normal">OS</th>
            <th className="pb-2 eyebrow font-normal">관리자</th>
            <th className="pb-2 eyebrow font-normal">부서</th>
            <th className="pb-2 eyebrow font-normal">상태</th>
          </tr>
        </thead>
        <tbody>
          {recentAssets.map((a) => (
            <tr key={a.id} className="border-b border-line last:border-0 hover-row">
              <td className="py-2 font-medium">{a.asset_name}</td>
              <td className="py-2">
                <span className={`text-xs px-2 py-0.5 rounded ${typeColors[a.asset_type] || typeColors.other}`}>
                  {typeLabels[a.asset_type] || a.asset_type}
                </span>
              </td>
              <td className="py-2 num text-ink-2 text-xs">{a.ip_address}</td>
              <td className="py-2 text-ink-2 text-xs">{a.os || "-"}</td>
              <td className="py-2 text-ink-2 text-xs">{a.admin_name || "-"}</td>
              <td className="py-2 text-ink-2 text-xs">{a.department || "-"}</td>
              <td className="py-2">
                <span className="inline-flex items-center gap-1.5 text-xs">
                  <span className={`led ${a.status === "active" ? "led-up" : a.status === "maintenance" ? "led-warn" : a.status === "retired" ? "led-fault" : "led-idle"}`} />
                  {statusLabels[a.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

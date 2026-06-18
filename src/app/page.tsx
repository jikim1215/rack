import { getDb } from "@/lib/db";
import {
  Server, Network, Shield, Phone, Cable,
  AlertTriangle, AlertCircle, CheckCircle, ChevronRight, Package, Activity, Wrench, XCircle, Archive,
} from "lucide-react";


function getStats() {
  const db = getDb();
  const totalAssets = (db.prepare("SELECT COUNT(*) as c FROM assets").get() as any).c;
  const byType = db.prepare("SELECT asset_type, COUNT(*) as c FROM assets GROUP BY asset_type").all() as any[];
  const activeAssets = (db.prepare("SELECT COUNT(*) as c FROM assets WHERE status='active'").get() as any).c;
  const totalRacks = (db.prepare("SELECT COUNT(*) as c FROM racks").get() as any).c;
  const totalPorts = (db.prepare("SELECT COUNT(*) as c FROM ports").get() as any).c;
  const usedPorts = (db.prepare("SELECT COUNT(*) as c FROM ports WHERE status='used'").get() as any).c;
  const totalLocations = (db.prepare("SELECT COUNT(*) as c FROM locations").get() as any).c;

  const rackUsage = db.prepare(`
    SELECT r.id, r.rack_name, r.total_units,

      COALESCE(SUM(a.rack_unit_size), 0) as used_units
    FROM racks r
    LEFT JOIN assets a ON a.rack_id = r.id
    GROUP BY r.id
  `).all() as any[];

  const recentAssets = db.prepare(`
    SELECT id, asset_name, asset_type, status, ip_address, os, admin_name, department, created_at

    FROM assets ORDER BY created_at DESC LIMIT 5
  `).all() as any[];

  const byDepartment = db.prepare(`
    SELECT department, COUNT(*) as c FROM assets WHERE department != '' GROUP BY department ORDER BY c DESC
  `).all() as any[];

  const byAdmin = db.prepare(`
    SELECT admin_name, COUNT(*) as c FROM assets WHERE admin_name != '' GROUP BY admin_name ORDER BY c DESC
  `).all() as any[];

  const byOs = db.prepare(`
    SELECT os, COUNT(*) as c FROM assets WHERE os != '' GROUP BY os ORDER BY c DESC LIMIT 8
  `).all() as any[];

  // 상태별 분포
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as c FROM assets GROUP BY status
  `).all() as any[];

  // EoS 경고 (이미 EoS이거나 90일 이내)
  const today = new Date().toISOString().slice(0, 10);
  const days90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const eosWarnings = db.prepare(`
    SELECT id, asset_name, asset_type, eos_date FROM assets

    WHERE eos_date != '' AND eos_date <= ?
    ORDER BY eos_date
    LIMIT 10
  `).all(days90) as any[];

  // 보증만료 경고
  const warrantyWarnings = db.prepare(`
    SELECT id, asset_name, asset_type, warranty_date FROM assets

    WHERE warranty_date != '' AND warranty_date <= ?
    ORDER BY warranty_date
    LIMIT 10
  `).all(days90) as any[];

  // 데이터 품질
  const dataQuality = db.prepare(`
    SELECT
      SUM(CASE WHEN ip_address = '' THEN 1 ELSE 0 END) as no_ip,
      SUM(CASE WHEN admin_name = '' THEN 1 ELSE 0 END) as no_admin,
      SUM(CASE WHEN rack_id IS NULL THEN 1 ELSE 0 END) as no_rack,
      SUM(CASE WHEN os = '' THEN 1 ELSE 0 END) as no_os
    FROM assets
  `).get() as any;

  return {
    totalAssets, byType, activeAssets, totalRacks, totalPorts, usedPorts,
    totalLocations, rackUsage, recentAssets, byDepartment, byAdmin, byOs,
    byStatus, eosWarnings, warrantyWarnings, dataQuality,
  };

}

const typeLabels: Record<string, string> = {
  server: "서버", network: "네트워크", security: "정보보호", telecom: "전화설비", other: "기타",
};
const typeIcons: Record<string, typeof Server> = {
  server: Server, network: Network, security: Shield, telecom: Phone, other: Cable,
};
const typeColors: Record<string, string> = {
  server: "bg-blue-100 text-blue-700",
  network: "bg-green-100 text-green-700",
  security: "bg-red-100 text-red-700",
  telecom: "bg-orange-100 text-orange-700",
  other: "bg-gray-100 text-gray-700",
};
const statusLabels: Record<string, string> = {
  active: "운용중", inactive: "미사용", maintenance: "점검중", decommissioned: "폐기", eos: "EoS(단종)",
};


export default function DashboardPage() {
  const stats = getStats();
  const today = new Date().toISOString().slice(0, 10);

  // 상태별 색상 맵
  const statusColors: Record<string, string> = {
    active: "bg-green-500",
    inactive: "bg-slate-400",
    maintenance: "bg-amber-500",
    eos: "bg-red-500",
    decommissioned: "bg-slate-300",
  };

  // 생명주기 단계 건수 계산
  const statusCount = (s: string) => stats.byStatus.find((x: any) => x.status === s)?.c ?? 0;
  const purchaseCount = stats.totalAssets - statusCount("active") - statusCount("inactive") - statusCount("maintenance") - statusCount("decommissioned") - statusCount("eos");
  const lifecycleSteps = [
    { key: "purchase", label: "도입", icon: Package, count: purchaseCount < 0 ? 0 : purchaseCount },
    { key: "active", label: "운용", icon: Activity, count: statusCount("active") },
    { key: "maintenance", label: "점검", icon: Wrench, count: statusCount("maintenance") },
    { key: "eos", label: "EoS", icon: XCircle, count: statusCount("eos") },
    { key: "decommissioned", label: "폐기", icon: Archive, count: statusCount("decommissioned") },
  ];

  // EoS + 보증 경고 합산 후 날짜순 정렬
  const allWarnings = [
    ...stats.eosWarnings.map((w: any) => ({ ...w, warnType: "EoS", date: w.eos_date })),
    ...stats.warrantyWarnings.map((w: any) => ({ ...w, warnType: "보증만료", date: w.warranty_date })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  // D-day 계산
  const dDay = (dateStr: string) => {
    const diff = Math.ceil((new Date(dateStr).getTime() - new Date(today).getTime()) / 86400000);
    return diff;
  };
  const dDayBadge = (dateStr: string) => {
    const d = dDay(dateStr);
    if (d <= 0) return <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">만료</span>;
    if (d <= 30) return <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">D-{d}</span>;
    return <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">D-{d}</span>;
  };

  // 데이터 품질 점수
  const dq = stats.dataQuality || { no_ip: 0, no_admin: 0, no_rack: 0, no_os: 0 };
  const totalDefects = (dq.no_ip || 0) + (dq.no_admin || 0) + (dq.no_rack || 0) + (dq.no_os || 0);
  const qualityScore = stats.totalAssets > 0
    ? Math.round((1 - totalDefects / (stats.totalAssets * 4)) * 100)
    : 100;
  const qualityItems = [
    { label: "IP 미입력", count: dq.no_ip || 0, icon: AlertCircle },
    { label: "관리자 미지정", count: dq.no_admin || 0, icon: AlertCircle },
    { label: "랙 미배치", count: dq.no_rack || 0, icon: AlertCircle },
    { label: "OS 미입력", count: dq.no_os || 0, icon: AlertCircle },
  ];


  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">대시보드</h2>

      {/* 요약 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="전체 자산" value={stats.totalAssets} sub={`운용중 ${stats.activeAssets}`} color="blue" />
        <StatCard label="랙" value={stats.totalRacks} sub={`${stats.totalLocations}개 위치`} color="green" />
        <StatCard label="전체 포트" value={stats.totalPorts} sub={`사용중 ${stats.usedPorts}`} color="purple" />
        <StatCard
          label="포트 사용률"
          value={stats.totalPorts > 0 ? `${Math.round((stats.usedPorts / stats.totalPorts) * 100)}%` : "0%"}
          sub={`${stats.usedPorts} / ${stats.totalPorts}`}
          color="amber"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* 자산 유형별 */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="font-semibold mb-4">자산 유형별 현황</h3>
          <div className="space-y-3">
            {stats.byType.map((t: any) => {
              const Icon = typeIcons[t.asset_type] || Server;
              return (
                <div key={t.asset_type} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded flex items-center justify-center ${typeColors[t.asset_type]}`}>
                      <Icon size={16} />
                    </div>
                    <span className="text-sm">{typeLabels[t.asset_type] || t.asset_type}</span>
                  </div>
                  <span className="font-semibold">{t.c}대</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 랙 사용률 */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="font-semibold mb-4">랙 사용률</h3>
          <div className="space-y-3">
            {stats.rackUsage.map((r: any) => {
              const pct = Math.round((r.used_units / r.total_units) * 100);
              return (
                <div key={r.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{r.rack_name}</span>

                    <span className="text-slate-500">{r.used_units}U / {r.total_units}U ({pct}%)</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-blue-500"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 부서별 / 관리자별 / OS별 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg border p-5">
          <h3 className="font-semibold mb-4">부서별 자산</h3>
          <div className="space-y-2">
            {stats.byDepartment.map((d: any) => (
              <div key={d.department} className="flex items-center justify-between text-sm">
                <span>{d.department}</span>
                <span className="font-semibold">{d.c}대</span>
              </div>
            ))}
            {stats.byDepartment.length === 0 && <p className="text-slate-400 text-sm">데이터 없음</p>}
          </div>
        </div>
        <div className="bg-white rounded-lg border p-5">
          <h3 className="font-semibold mb-4">관리자별 자산</h3>
          <div className="space-y-2">
            {stats.byAdmin.map((d: any) => (
              <div key={d.admin_name} className="flex items-center justify-between text-sm">
                <span>{d.admin_name}</span>
                <span className="font-semibold">{d.c}대</span>
              </div>
            ))}
            {stats.byAdmin.length === 0 && <p className="text-slate-400 text-sm">데이터 없음</p>}
          </div>
        </div>
        <div className="bg-white rounded-lg border p-5">
          <h3 className="font-semibold mb-4">OS / 펌웨어 분포</h3>
          <div className="space-y-2">
            {stats.byOs.map((d: any) => (
              <div key={d.os} className="flex items-center justify-between text-sm">
                <span className="truncate mr-2">{d.os}</span>
                <span className="font-semibold shrink-0">{d.c}대</span>
              </div>
            ))}
            {stats.byOs.length === 0 && <p className="text-slate-400 text-sm">데이터 없음</p>}
          </div>
        </div>
      </div>

      {/* 패널 1: 상태별 자산 분포 */}
      <div className="bg-white rounded-lg border p-5 mb-8">
        <h3 className="font-semibold mb-4">상태별 자산 분포</h3>
        {stats.totalAssets > 0 ? (
          <>
            <div className="flex h-6 rounded-full overflow-hidden mb-3">
              {stats.byStatus.map((s: any) => {
                const pct = (s.c / stats.totalAssets) * 100;
                if (pct === 0) return null;
                return (
                  <div
                    key={s.status}
                    className={`${statusColors[s.status] || "bg-slate-200"} transition-all`}
                    style={{ width: `${pct}%` }}
                    title={`${statusLabels[s.status] || s.status}: ${s.c}대 (${Math.round(pct)}%)`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {stats.byStatus.map((s: any) => (
                <div key={s.status} className="flex items-center gap-1.5">
                  <span className={`w-3 h-3 rounded-full ${statusColors[s.status] || "bg-slate-200"}`} />
                  <span className="text-slate-600">{statusLabels[s.status] || s.status}</span>
                  <span className="font-semibold">{s.c}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-slate-400 text-sm">자산 데이터 없음</p>
        )}
      </div>

      {/* 패널 2: 생명주기 흐름 */}
      <div className="bg-white rounded-lg border p-5 mb-8">
        <h3 className="font-semibold mb-4">생명주기 흐름</h3>
        <div className="flex items-center justify-between overflow-x-auto gap-1">
          {lifecycleSteps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={step.key} className="flex items-center">
                <div className="flex flex-col items-center min-w-[80px]">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    step.count > 0 ? "bg-blue-50 text-blue-600" : "bg-slate-50 text-slate-400"
                  }`}>
                    <Icon size={20} />
                  </div>
                  <span className="text-xs mt-1 text-slate-600">{step.label}</span>
                  <span className="text-sm font-bold">{step.count}대</span>
                </div>
                {i < lifecycleSteps.length - 1 && (
                  <ChevronRight size={16} className="text-slate-300 mx-1 shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* 패널 3: EoS/보증 경고 */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-500" />
            EoS / 보증만료 경고
          </h3>
          {allWarnings.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {allWarnings.map((w: any, i: number) => (
                <div key={`${w.warnType}-${w.id}-${i}`} className="flex items-center justify-between text-sm border-b last:border-0 pb-2">
                  <div>
                    <span className="font-medium">{w.asset_name}</span>

                    <span className="text-xs text-slate-400 ml-2">{typeLabels[w.asset_type] || w.asset_type}</span>
                    <span className="text-xs text-slate-400 ml-2">[{w.warnType}]</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-500">{w.date}</span>
                    {dDayBadge(w.date)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <CheckCircle size={16} />
              경고 없음 ✓
            </div>
          )}
        </div>

        {/* 패널 4: 데이터 품질 */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="font-semibold mb-4">데이터 품질</h3>
          <div className="flex items-center gap-3 mb-4">
            <div className={`text-3xl font-bold ${qualityScore >= 80 ? "text-green-600" : qualityScore >= 50 ? "text-amber-600" : "text-red-600"}`}>
              {qualityScore}%
            </div>
            <span className="text-sm text-slate-500">전체 품질 점수</span>
          </div>
          <div className="space-y-3">
            {qualityItems.map((item) => {
              const pct = stats.totalAssets > 0 ? Math.round((item.count / stats.totalAssets) * 100) : 0;
              const isClean = item.count === 0;
              return (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {isClean ? (
                      <CheckCircle size={16} className="text-green-500" />
                    ) : (
                      <AlertCircle size={16} className="text-amber-500" />
                    )}
                    <span>{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold ${isClean ? "text-green-600" : "text-amber-600"}`}>{item.count}건</span>
                    <span className="text-xs text-slate-400">({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 최근 등록 자산 */}
      <div className="bg-white rounded-lg border p-5">
        <h3 className="font-semibold mb-4">최근 등록 자산</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="pb-2">이름</th>
              <th className="pb-2">유형</th>
              <th className="pb-2">IP</th>
              <th className="pb-2">OS</th>
              <th className="pb-2">관리자</th>
              <th className="pb-2">부서</th>
              <th className="pb-2">상태</th>
            </tr>
          </thead>
          <tbody>
            {stats.recentAssets.map((a: any) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className="py-2 font-medium">{a.asset_name}</td>
                <td className="py-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${typeColors[a.asset_type]}`}>
                    {typeLabels[a.asset_type]}
                  </span>
                </td>
                <td className="py-2 text-slate-500 font-mono text-xs">{a.ip_address}</td>
                <td className="py-2 text-slate-500 text-xs">{a.os || "-"}</td>
                <td className="py-2 text-slate-500 text-xs">{a.admin_name || "-"}</td>
                <td className="py-2 text-slate-500 text-xs">{a.department || "-"}</td>
                <td className="py-2">
                  <span className={`text-xs ${a.status === "active" ? "text-green-600" : "text-slate-400"}`}>
                    {statusLabels[a.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub: string; color: string }) {
  const colors: Record<string, string> = {
    blue: "border-l-blue-500",
    green: "border-l-green-500",
    purple: "border-l-purple-500",
    amber: "border-l-amber-500",
  };
  return (
    <div className={`bg-white rounded-lg border border-l-4 ${colors[color]} p-4`}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      <p className="text-xs text-slate-400 mt-1">{sub}</p>
    </div>
  );
}

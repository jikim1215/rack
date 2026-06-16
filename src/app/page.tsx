import { getDb } from "@/lib/db";
import { Server, Network, Shield, HardDrive, Cable } from "lucide-react";

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
    SELECT r.id, r.name, r.total_units,
      COALESCE(SUM(a.rack_unit_size), 0) as used_units
    FROM racks r
    LEFT JOIN assets a ON a.rack_id = r.id
    GROUP BY r.id
  `).all() as any[];

  const recentAssets = db.prepare(`
    SELECT id, name, asset_type, status, ip_address, created_at
    FROM assets ORDER BY created_at DESC LIMIT 5
  `).all() as any[];

  return {
    totalAssets, byType, activeAssets, totalRacks, totalPorts, usedPorts,
    totalLocations, rackUsage, recentAssets,
  };
}

const typeLabels: Record<string, string> = {
  server: "서버", network: "네트워크", security: "정보보호", storage: "스토리지", other: "기타",
};
const typeIcons: Record<string, typeof Server> = {
  server: Server, network: Network, security: Shield, storage: HardDrive, other: Cable,
};
const typeColors: Record<string, string> = {
  server: "bg-blue-100 text-blue-700",
  network: "bg-green-100 text-green-700",
  security: "bg-red-100 text-red-700",
  storage: "bg-purple-100 text-purple-700",
  other: "bg-gray-100 text-gray-700",
};
const statusLabels: Record<string, string> = {
  active: "운용중", inactive: "미사용", maintenance: "점검중", decommissioned: "폐기",
};

export default function DashboardPage() {
  const stats = getStats();

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
                    <span>{r.name}</span>
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

      {/* 최근 등록 자산 */}
      <div className="bg-white rounded-lg border p-5">
        <h3 className="font-semibold mb-4">최근 등록 자산</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="pb-2">이름</th>
              <th className="pb-2">유형</th>
              <th className="pb-2">IP</th>
              <th className="pb-2">상태</th>
              <th className="pb-2">등록일</th>
            </tr>
          </thead>
          <tbody>
            {stats.recentAssets.map((a: any) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className="py-2 font-medium">{a.name}</td>
                <td className="py-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${typeColors[a.asset_type]}`}>
                    {typeLabels[a.asset_type]}
                  </span>
                </td>
                <td className="py-2 text-slate-500 font-mono text-xs">{a.ip_address}</td>
                <td className="py-2">
                  <span className={`text-xs ${a.status === "active" ? "text-green-600" : "text-slate-400"}`}>
                    {statusLabels[a.status]}
                  </span>
                </td>
                <td className="py-2 text-slate-400 text-xs">{a.created_at}</td>
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

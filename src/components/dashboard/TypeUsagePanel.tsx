// ── 자산 유형별 현황 + 랙 사용률 (히어로 아래 2열 그리드) ──
import Panel from "./Panel";
import { typeLabels, typeIcons, typeColors } from "./labels";
import { Server } from "lucide-react";
import type { RackRow } from "@/lib/db-types";

type RackUsageRow = Pick<RackRow, "id" | "rack_name" | "total_units"> & { used_units: number };

export default function TypeUsagePanel({
  byType, rackUsage,
}: {
  byType: { asset_type: string; c: number }[];
  rackUsage: RackUsageRow[];
}) {
  // 랙 사용률 — 열(그룹) 단위 요약 후 펼침 (랙 57식 전체 나열 방지)
  const groups = new Map<string, RackUsageRow[]>();
  for (const r of rackUsage) {
    const key = String(r.rack_name).match(/^([A-Za-z가-힣]+)[-_ ]?\d/)?.[1]?.toUpperCase() || "기타";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const groupEntries = [...groups.entries()]
    .sort(([a], [b]) => (a === "기타" ? 1 : b === "기타" ? -1 : a.localeCompare(b)));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
      {/* 자산 유형별 */}
      <Panel title="자산 유형별 현황" code="TYPE">
        <div className="space-y-3">
          {byType.map((t) => {
            const Icon = typeIcons[t.asset_type] || Server;
            return (
              <div key={t.asset_type} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded flex items-center justify-center ${typeColors[t.asset_type] || typeColors.other}`}>
                    <Icon size={16} />
                  </div>
                  <span className="text-sm">{typeLabels[t.asset_type] || t.asset_type}</span>
                </div>
                <span className="num font-semibold">{t.c}<span className="text-ink-3 text-xs ml-0.5">대</span></span>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* 랙 사용률 */}
      <Panel title="랙 사용률" code="RACK·U">
        <div className="space-y-2">
          {groupEntries.map(([key, racks]) => {
            const used = racks.reduce((s, r) => s + r.used_units, 0);
            const total = racks.reduce((s, r) => s + r.total_units, 0);
            const gpct = total > 0 ? Math.round((used / total) * 100) : 0;
            const hot = racks.filter((r) => r.total_units > 0 && r.used_units / r.total_units > 0.8).length;
            return (
              <details key={key} className="group border border-line rounded-lg">
                <summary className="cursor-pointer list-none px-3 py-2.5 hover:bg-surface rounded-lg">
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="font-medium">
                      {key.length === 1 ? `${key}열` : key} <span className="text-ink-3 text-xs">랙 {racks.length}식</span>
                      {hot > 0 && <span className="text-fault text-xs ml-1.5">80%↑ {hot}</span>}
                      <span className="text-ink-3 text-xs ml-1.5 group-open:hidden">펼치기 ▾</span>
                      <span className="text-ink-3 text-xs ml-1.5 hidden group-open:inline">접기 ▴</span>
                    </span>
                    <span className="num text-ink-2">{used}U / {total}U <span className="text-ink-3">({gpct}%)</span></span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${gpct > 80 ? "bg-fault" : gpct > 50 ? "bg-warn" : "bg-signal"}`} style={{ width: `${gpct}%` }} />
                  </div>
                </summary>
                <div className="space-y-3 px-3 pb-3 pt-1 border-t border-line">
                  {racks.map((r) => {
                    const pct = r.total_units > 0 ? Math.round((r.used_units / r.total_units) * 100) : 0;
                    return (
                      <div key={r.id}>
                        <div className="flex justify-between text-sm mb-1.5">
                          <span>{r.rack_name}</span>
                          <span className="num text-ink-2">{r.used_units}U / {r.total_units}U <span className="text-ink-3">({pct}%)</span></span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct > 80 ? "bg-fault" : pct > 50 ? "bg-warn" : "bg-signal"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

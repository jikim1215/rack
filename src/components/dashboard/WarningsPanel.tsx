// ── EoS / 보증만료 경고 패널 ──
import { AlertTriangle, CheckCircle } from "lucide-react";
import Panel from "./Panel";
import { typeLabels } from "./labels";

interface Warning {
  id: number;
  asset_name: string;
  asset_type: string;
  warnType: "EoS" | "보증만료";
  date: string;
}

// D-day 계산
function dDay(dateStr: string, today: string): number {
  return Math.ceil((new Date(dateStr).getTime() - new Date(today).getTime()) / 86400000);
}
function dDayBadge(dateStr: string, today: string) {
  const d = dDay(dateStr, today);
  if (d <= 0) return <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">만료</span>;
  if (d <= 30) return <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">D-{d}</span>;
  return <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">D-{d}</span>;
}

export default function WarningsPanel({
  eosWarnings, warrantyWarnings, today,
}: {
  eosWarnings: { id: number; asset_name: string; asset_type: string; eos_date: string }[];
  warrantyWarnings: { id: number; asset_name: string; asset_type: string; warranty_date: string }[];
  today: string;
}) {
  // EoS + 보증 경고 합산 후 날짜순 정렬
  const allWarnings: Warning[] = [
    ...eosWarnings.map((w) => ({ id: w.id, asset_name: w.asset_name, asset_type: w.asset_type, warnType: "EoS" as const, date: w.eos_date })),
    ...warrantyWarnings.map((w) => ({ id: w.id, asset_name: w.asset_name, asset_type: w.asset_type, warnType: "보증만료" as const, date: w.warranty_date })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Panel
      title="EoS / 보증만료 경고"
      code="EOS·WTY"
      icon={<AlertTriangle size={16} className="text-warn" />}
    >
      {allWarnings.length > 0 ? (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {allWarnings.map((w, i) => (
            <div key={`${w.warnType}-${w.id}-${i}`} className="flex items-center justify-between text-sm border-b border-line last:border-0 pb-2">
              <div>
                <span className="font-medium">{w.asset_name}</span>
                <span className="text-xs text-ink-3 ml-2">{typeLabels[w.asset_type] || w.asset_type}</span>
                <span className="eyebrow ml-2 !text-[0.625rem]">{w.warnType}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="num text-xs text-ink-2">{w.date}</span>
                {dDayBadge(w.date, today)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-signal text-sm">
          <CheckCircle size={16} />
          경고 없음
        </div>
      )}
    </Panel>
  );
}

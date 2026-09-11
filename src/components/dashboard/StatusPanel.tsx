// ── 상태별 자산 분포 패널 ──
import Panel from "./Panel";
import { statusColors, statusLabels } from "./labels";

export default function StatusPanel({
  totalAssets, byStatus,
}: {
  totalAssets: number;
  byStatus: { status: string; c: number }[];
}) {
  return (
    <Panel title="상태별 자산 분포" code="STATUS" className="mb-5">
      {totalAssets > 0 ? (
        <>
          <div className="flex h-6 rounded-full overflow-hidden mb-3">
            {byStatus.map((s) => {
              const pct = (s.c / totalAssets) * 100;
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
            {byStatus.map((s) => (
              <div key={s.status} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${statusColors[s.status] || "bg-slate-200"}`} />
                <span className="text-ink-2">{statusLabels[s.status] || s.status}</span>
                <span className="num font-semibold">{s.c}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-ink-3 text-sm">자산 데이터 없음</p>
      )}
    </Panel>
  );
}

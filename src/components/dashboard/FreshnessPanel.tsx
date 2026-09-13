import Link from "next/link";
import { ShieldCheck, ArrowRight } from "lucide-react";
import Panel from "./Panel";

export interface FreshnessPanelProps {
  freshness: {
    fresh: number;
    aging: number;
    stale: number;
    never: number;
  };
  byTeam: {
    team_id: number | null;
    team_name: string;
    total: number;
    fresh: number;
    verifiedPct: number;
  }[];
  className?: string;
}

export default function FreshnessPanel({
  freshness,
  byTeam,
  className = "",
}: FreshnessPanelProps) {
  const total = freshness.fresh + freshness.aging + freshness.stale + freshness.never;
  const verifiedRate = total > 0 ? Math.round((freshness.fresh / total) * 100) : 0;

  const buckets = [
    { key: "fresh", label: "90일 내 확인", count: freshness.fresh, color: "bg-emerald-500" },
    { key: "aging", label: "확인 후 90일 경과", count: freshness.aging, color: "bg-amber-500" },
    { key: "stale", label: "180일 이상 미확인", count: freshness.stale, color: "bg-rose-500" },
    { key: "never", label: "확인 이력 없음", count: freshness.never, color: "bg-slate-300" },
  ];

  return (
    <Panel title="현행화 현황" code="FRESHNESS" icon={<ShieldCheck size={18} className="text-signal" />} className={className}>
      {/* 상단 4버킷 누적 막대 + 수치 */}
      <div className="mb-5">
        <div className="flex items-baseline justify-between mb-2">
          <div className="flex items-baseline gap-2">
            <span className="num text-3xl font-bold tracking-tight text-ink">{verifiedRate}%</span>
            <span className="text-sm text-ink-2">90일 내 현행 확인 완료 ({freshness.fresh}/{total}대)</span>
          </div>
        </div>

        {/* 누적 막대 */}
        {total > 0 ? (
          <div className="flex h-4 rounded-full overflow-hidden mb-3 bg-slate-100">
            {buckets.map((b) => {
              const pct = (b.count / total) * 100;
              if (pct === 0) return null;
              return (
                <div
                  key={b.key}
                  className={`${b.color} transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${b.label}: ${b.count}대 (${Math.round(pct)}%)`}
                />
              );
            })}
          </div>
        ) : (
          <div className="h-4 rounded-full bg-slate-100 mb-3" />
        )}

        {/* 4버킷 수치 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {buckets.map((b) => {
            const pct = total > 0 ? Math.round((b.count / total) * 100) : 0;
            return (
              <div key={b.key} className="p-2 rounded bg-slate-50 border border-line flex flex-col justify-between">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`w-2 h-2 rounded-full ${b.color}`} />
                  <span className="text-ink-2 font-medium truncate">{b.label}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="num text-sm font-semibold text-ink">{b.count}대</span>
                  <span className="num text-ink-3">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 팀별 현행화율 순위 표 (팀이 1개 이하면 단일 요약) */}
      {byTeam.length > 1 ? (
        <div className="space-y-3 mb-4">
          <h4 className="text-xs font-semibold text-ink-3 uppercase tracking-wider">팀별 현행화율 순위</h4>
          <div className="divide-y divide-line border border-line rounded-lg overflow-hidden bg-white">
            {byTeam.map((team) => (
              <Link
                key={team.team_id ?? "unassigned"}
                href="/assets?missing=verify"
                className="flex items-center justify-between p-2.5 hover:bg-slate-50 transition-colors group"
              >
                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-ink truncate group-hover:text-signal transition-colors">{team.team_name}</span>
                    <span className="num text-ink-3">{team.fresh} / {team.total}대 ({team.verifiedPct}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-signal transition-all rounded-full"
                      style={{ width: `${Math.min(100, Math.max(0, team.verifiedPct))}%` }}
                    />
                  </div>
                </div>
                <ArrowRight size={14} className="text-ink-3 group-hover:text-signal transition-colors shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      ) : byTeam.length === 1 ? (
        <div className="p-3 mb-4 rounded-lg bg-slate-50 border border-line flex items-center justify-between text-sm">
          <span className="text-ink-2 font-medium">{byTeam[0].team_name}</span>
          <div className="flex items-center gap-2">
            <span className="num font-semibold text-ink">{byTeam[0].fresh} / {byTeam[0].total}대</span>
            <span className="num text-signal font-bold">({byTeam[0].verifiedPct}%)</span>
          </div>
        </div>
      ) : null}

      {/* 하단 설명 */}
      <p className="text-xs text-ink-3 bg-slate-50 p-2.5 rounded border border-line/60">
        현행 확인 = 값을 바꾸지 않아도 &apos;봤고 맞다&apos;를 기록. 90일이 지나면 다시 확인 대상
      </p>
    </Panel>
  );
}

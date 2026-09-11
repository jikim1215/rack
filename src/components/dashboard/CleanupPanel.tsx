// ── 정리 필요 큐 / 데이터 품질 (P6 · AC-2/13/14) ──
import Link from "next/link";
import Panel from "./Panel";
import { typeLabels } from "./labels";
import type { CleanupStats } from "@/lib/dashboard-stats";

export default function CleanupPanel({
  isAdmin, cleanupCount, issueSummary, cleanupQueue, dupSuspect, rackConflicts, byTeam,
}: {
  isAdmin: boolean;
  cleanupCount: number;
  issueSummary: CleanupStats["issueSummary"];
  cleanupQueue: CleanupStats["cleanupQueue"];
  dupSuspect: CleanupStats["dupSuspect"];
  rackConflicts: CleanupStats["rackConflicts"];
  byTeam: CleanupStats["byTeam"];
}) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline gap-2 mb-3">
        <span className="eyebrow">CLEANUP · 정리 필요 큐</span>
        <span className="num text-base font-bold text-ink">{cleanupCount}</span>
        <span className="text-sm text-ink-3">건 정리 필요</span>
        {isAdmin && (
          <Link href="/import-issues" className="text-xs text-signal hover:underline ml-2">이슈 처리 화면 →</Link>
        )}
      </div>
      {/* 가져오기 이슈 유형별 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        {[
          { label: "오류", count: issueSummary.error, tone: "text-fault" },
          { label: "식별자 없음", count: issueSummary.missing_id, tone: "text-warn" },
          { label: "OS 미입력", count: issueSummary.missing_os, tone: "text-warn" },
          { label: "중복 의심", count: issueSummary.dup_suspect, tone: "text-warn" },
          { label: "날짜 해석 불가", count: issueSummary.date_format, tone: "text-warn" },
          { label: "중복 그룹(동명이기)", count: dupSuspect.groups, tone: "text-ink-2" },
        ].map((c) => (
          <div key={c.label} className="card p-4">
            <div className={`num text-3xl font-bold leading-none ${c.tone}`}>{c.count}</div>
            <div className="eyebrow mt-2">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 정리 필요 큐 목록 */}
        <Panel title="정리 필요 큐" code="CLEANUP">
          {cleanupCount === 0 ? (
            <p className="text-ink-3 text-sm">정리할 자산이 없습니다.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {cleanupQueue.map((q) => (
                <div key={q.asset_id} className="flex items-center justify-between text-sm border-b border-line last:border-0 pb-1.5">
                  <div className="min-w-0">
                    <span className="truncate font-medium">{q.asset_name}</span>
                    <span className="eyebrow ml-2 !text-[0.625rem]">{typeLabels[q.asset_type] || q.asset_type}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {q.missing_ip === 1 && <span className="text-[0.625rem] px-1.5 py-0.5 rounded bg-amber-50 text-warn">IP</span>}
                    {q.missing_os === 1 && <span className="text-[0.625rem] px-1.5 py-0.5 rounded bg-amber-50 text-warn">OS</span>}
                    {q.missing_admin === 1 && <span className="text-[0.625rem] px-1.5 py-0.5 rounded bg-amber-50 text-warn">관리자</span>}
                    {q.missing_rack === 1 && <span className="text-[0.625rem] px-1.5 py-0.5 rounded bg-amber-50 text-warn">랙</span>}
                    {q.import_issue_count > 0 && <span className="text-[0.625rem] px-1.5 py-0.5 rounded bg-red-50 text-fault">이슈 {q.import_issue_count}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* 실장 충돌/범위초과 — 판정 규칙: src/lib/rack-overlap.ts (dashboard-stats.ts SQL과 동일) */}
          <div className="mt-3 pt-3 border-t border-line">
            <p className="eyebrow mb-2">
              실장 충돌 <span className={`num text-base font-bold ml-1 ${rackConflicts.conflicts.length > 0 ? "text-fault" : "text-ink"}`}>{rackConflicts.conflicts.length}</span>
              <span className="mx-1">·</span>범위초과 <span className={`num text-base font-bold ml-1 ${rackConflicts.overflows.length > 0 ? "text-warn" : "text-ink"}`}>{rackConflicts.overflows.length}</span>
            </p>
            {rackConflicts.conflicts.length === 0 && rackConflicts.overflows.length === 0 ? (
              <p className="text-ink-3 text-sm">랙 배치 이상 없음</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {rackConflicts.conflicts.map((c, i) => (
                  <Link key={`rc-${i}`} href="/racks" className="flex items-center justify-between text-sm border-b border-line last:border-0 pb-1.5 hover:bg-surface transition-colors" title={`${c.rack_name} ${c.unit_range} 충돌 — 랙 실장도 바로가기`}>
                    <div className="min-w-0">
                      <span className="truncate font-medium">{c.a_name}</span>
                      <span className="text-ink-3 mx-1">↔</span>
                      <span className="truncate font-medium">{c.b_name}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <span className="num text-xs text-ink-3">{c.rack_name} <span className="num">{c.unit_range}</span></span>
                      <span className="text-[0.625rem] px-1.5 py-0.5 rounded bg-red-50 text-fault">충돌</span>
                    </div>
                  </Link>
                ))}
                {rackConflicts.overflows.map((o, i) => (
                  <Link key={`ro-${i}`} href="/racks" className="flex items-center justify-between text-sm border-b border-line last:border-0 pb-1.5 hover:bg-surface transition-colors" title={`${o.rack_name} ${o.unit_range} 범위초과 — 랙 실장도 바로가기`}>
                    <div className="min-w-0">
                      <span className="truncate font-medium">{o.asset_name}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <span className="num text-xs text-ink-3">{o.rack_name} <span className="num">{o.unit_range}/{o.total_units}U</span></span>
                      <span className="text-[0.625rem] px-1.5 py-0.5 rounded bg-amber-50 text-warn">범위초과</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </Panel>

        {/* 중복 의심 (동명이기 판별) */}
        <Panel title="중복 의심 · 동명이기" code="DUP">
          <p className="eyebrow mb-3">
            그룹 <span className="num text-base font-bold text-ink ml-1">{dupSuspect.groups}</span> · 의심 자산
            <span className="num text-base font-bold text-ink ml-1">{dupSuspect.assets}</span> · 진성 중복 후보
            <span className="num text-base font-bold text-fault ml-1">{dupSuspect.likelyDup}</span>
          </p>
          {dupSuspect.topGroups.length === 0 ? (
            <p className="text-ink-3 text-sm">중복 의심 없음</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {dupSuspect.topGroups.map((g, i) => {
                const likely = g.distinct_serials <= 1 && g.distinct_ips <= 1;
                return (
                  <div key={g.asset_name + i} className="flex items-center justify-between text-sm border-b border-line last:border-0 pb-1.5">
                    <span className="truncate font-medium">{g.asset_name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="num text-xs text-ink-3">{g.c}건</span>
                      <span className={`text-[0.625rem] px-1.5 py-0.5 rounded ${likely ? "bg-red-50 text-fault" : "bg-slate-100 text-ink-2"}`}>
                        {likely ? "진성 중복 의심" : "동명이기 가능"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* 팀별 자산 수 */}
        <Panel title="팀별 자산 수" code="TEAM">
          {byTeam.length === 0 ? (
            <p className="text-ink-3 text-sm">자산 없음</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {byTeam.map((t, i) => (
                <div key={(t.team_id ?? "none") + "-" + i} className="flex items-center justify-between text-sm border-b border-line last:border-0 pb-1.5">
                  <span className={`truncate ${t.team_id == null ? "text-warn" : ""}`}>{t.team_name}</span>
                  <span className="num font-semibold">{t.c}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

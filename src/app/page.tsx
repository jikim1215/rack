export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import {
  Server, Network, Shield, Phone, Cable,
  AlertTriangle, AlertCircle, CheckCircle, ChevronRight, Package, Activity, Wrench, XCircle, Archive,
  ArrowLeftRight, FileText, ArrowDownToLine, ArrowUpFromLine, HardDrive, Globe,
} from "lucide-react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { actorFromSession, scopeWhere, rackScopeWhere, locationScopeWhere } from "@/lib/authz";
import { computeCleanupStats } from "@/lib/dashboard-stats";



async function getStats() {
  const db = getDb();
  const actor = actorFromSession(await getSession());
  const scope = scopeWhere(actor, "team_id");
  const scopeA = scopeWhere(actor, "a.team_id");
  const totalAssets = (db.prepare(`SELECT COUNT(*) as c FROM assets WHERE ${scope.sql}`).get(...scope.params) as any).c;
  const byType = db.prepare(`SELECT asset_type, COUNT(*) as c FROM assets WHERE ${scope.sql} GROUP BY asset_type`).all(...scope.params) as any[];
  const activeAssets = (db.prepare(`SELECT COUNT(*) as c FROM assets WHERE status='active' AND ${scope.sql}`).get(...scope.params) as any).c;
  // 랙/위치 집계도 팀 가시성 기준(하이브리드). 총괄/전체열람은 전체.
  const rackScope = rackScopeWhere(actor, "r.team_id", "r.id");
  const rackScopeC = rackScopeWhere(actor, "team_id", "id");
  const locScope = locationScopeWhere(actor, "team_id", "id");
  const totalRacks = (db.prepare(`SELECT COUNT(*) as c FROM racks WHERE ${rackScopeC.sql}`).get(...rackScopeC.params) as any).c;
  const totalPorts = (db.prepare("SELECT COUNT(*) as c FROM ports").get() as any).c;
  const usedPorts = (db.prepare("SELECT COUNT(*) as c FROM ports WHERE status='used'").get() as any).c;
  const totalLocations = (db.prepare(`SELECT COUNT(*) as c FROM locations WHERE ${locScope.sql}`).get(...locScope.params) as any).c;

  const rackUsage = db.prepare(`
    SELECT r.id, r.rack_name, r.total_units,
      COALESCE(SUM(a.rack_unit_size), 0) as used_units
    FROM racks r
    LEFT JOIN assets a ON a.rack_id = r.id AND ${scopeA.sql}
    WHERE ${rackScope.sql}
    GROUP BY r.id
  `).all(...scopeA.params, ...rackScope.params) as any[];

  const recentAssets = db.prepare(`
    SELECT id, asset_name, asset_type, status, ip_address, os, admin_name, department, created_at
    FROM assets WHERE ${scope.sql} ORDER BY created_at DESC LIMIT 5
  `).all(...scope.params) as any[];

  const byDepartment = db.prepare(`
    SELECT department, COUNT(*) as c FROM assets WHERE department != '' AND ${scope.sql} GROUP BY department ORDER BY c DESC
  `).all(...scope.params) as any[];

  const byAdmin = db.prepare(`
    SELECT admin_name, COUNT(*) as c FROM assets WHERE admin_name != '' AND ${scope.sql} GROUP BY admin_name ORDER BY c DESC
  `).all(...scope.params) as any[];

  const byOs = db.prepare(`
    SELECT os, COUNT(*) as c FROM assets WHERE os != '' AND ${scope.sql} GROUP BY os ORDER BY c DESC
  `).all(...scope.params) as any[];

  // 상태별 분포
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as c FROM assets WHERE ${scope.sql} GROUP BY status
  `).all(...scope.params) as any[];

  // EoS 경고 (이미 EoS이거나 90일 이내)
  const today = new Date().toISOString().slice(0, 10);
  const days90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const eosWarnings = db.prepare(`
    SELECT id, asset_name, asset_type, eos_date FROM assets
    WHERE eos_date != '' AND eos_date <= ? AND ${scope.sql}
    ORDER BY eos_date
    LIMIT 10
  `).all(days90, ...scope.params) as any[];

  // 보증만료 경고
  const warrantyWarnings = db.prepare(`
    SELECT id, asset_name, asset_type, warranty_date FROM assets
    WHERE warranty_date != '' AND warranty_date <= ? AND ${scope.sql}
    ORDER BY warranty_date
    LIMIT 10
  `).all(days90, ...scope.params) as any[];

  // 데이터 품질
  const dataQuality = db.prepare(`
    SELECT
      SUM(CASE WHEN ip_address = '' THEN 1 ELSE 0 END) as no_ip,
      SUM(CASE WHEN admin_name = '' THEN 1 ELSE 0 END) as no_admin,
      SUM(CASE WHEN rack_id IS NULL THEN 1 ELSE 0 END) as no_rack,
      SUM(CASE WHEN os = '' THEN 1 ELSE 0 END) as no_os
    FROM assets WHERE ${scope.sql}
  `).get(...scope.params) as any;
  // 반입/반출 현황
  const pendingMovements = (db.prepare(`SELECT COUNT(*) as c FROM asset_movements m LEFT JOIN assets a ON m.asset_id = a.id WHERE m.status='requested' AND (m.asset_id IS NULL OR ${scopeA.sql})`).get(...scopeA.params) as any).c;
  const recentMovements = db.prepare(
    `SELECT m.*, a.asset_name FROM asset_movements m LEFT JOIN assets a ON m.asset_id = a.id WHERE (m.asset_id IS NULL OR ${scopeA.sql}) ORDER BY m.created_at DESC LIMIT 5`
  ).all(...scopeA.params) as any[];

  // 라이프사이클 흐름: 반입 진행(미완료) / 반출 진행(미완료) 건수
  const bringInPending = (db.prepare(
    `SELECT COUNT(*) as c FROM asset_movements m LEFT JOIN assets a ON m.asset_id = a.id
     WHERE m.movement_type='bring_in' AND m.status IN ('requested','approved') AND (m.asset_id IS NULL OR ${scopeA.sql})`
  ).get(...scopeA.params) as any).c;
  const bringOutInProgress = (db.prepare(
    `SELECT COUNT(*) as c FROM asset_movements m LEFT JOIN assets a ON m.asset_id = a.id
     WHERE m.movement_type='bring_out' AND m.status IN ('requested','approved') AND (m.asset_id IS NULL OR ${scopeA.sql})`
  ).get(...scopeA.params) as any).c;

  // 유지보수 현황
  const openMaintenance = (db.prepare(`SELECT COUNT(*) as c FROM maintenance_logs ml LEFT JOIN assets a ON ml.asset_id = a.id WHERE ml.status IN ('open','in_progress') AND (ml.asset_id IS NULL OR ${scopeA.sql})`).get(...scopeA.params) as any).c;
  const recentMaintenance = db.prepare(
    `SELECT ml.*, a.asset_name FROM maintenance_logs ml LEFT JOIN assets a ON ml.asset_id = a.id WHERE (ml.asset_id IS NULL OR ${scopeA.sql}) ORDER BY ml.created_at DESC LIMIT 5`
  ).all(...scopeA.params) as any[];

  // 계약 만료 현황
  const contractScope = scopeWhere(actor, "c.team_id");
  const expiringContracts = db.prepare(
    `SELECT c.*, v.vendor_name FROM contracts c LEFT JOIN vendors v ON c.vendor_id = v.id
     WHERE c.status = 'active' AND c.end_date != '' AND c.end_date <= ? AND ${contractScope.sql} ORDER BY c.end_date LIMIT 5`
  ).all(days90, ...contractScope.params) as any[];

  // ── P6 정리 필요 큐 / 데이터 품질 (AC-2/13/14) — src/lib/dashboard-stats.ts ──
  const { byTeam, issueSummary, cleanupCount, cleanupQueue, dupSuspect, rackConflicts } =
    computeCleanupStats(db, scope, scopeA);


  return {
    totalAssets, byType, activeAssets, totalRacks, totalPorts, usedPorts,
    totalLocations, rackUsage, recentAssets, byDepartment, byAdmin, byOs,
    byStatus, eosWarnings, warrantyWarnings, dataQuality,
    pendingMovements, recentMovements, openMaintenance, recentMaintenance, expiringContracts,
    bringInPending, bringOutInProgress,
    byTeam, issueSummary, cleanupCount, cleanupQueue, dupSuspect, rackConflicts,
  };


}

const typeLabels: Record<string, string> = {
  server: "서버", network: "네트워크", security: "정보보호", telecom: "전화설비", other: "기타",
};
const typeIcons: Record<string, typeof Server> = {
  server: Server, network: Network, security: Shield, telecom: Phone, other: Cable,
};
// 자산 유형은 범주 — 색이 아니라 아이콘으로 구분 (색은 상태 신호 전용)
const typeColors: Record<string, string> = {
  server: "bg-slate-100 text-slate-600",
  network: "bg-slate-100 text-slate-600",
  security: "bg-slate-100 text-slate-600",
  telecom: "bg-slate-100 text-slate-600",
  other: "bg-slate-100 text-slate-600",
};
const statusLabels: Record<string, string> = {
  active: "운용중", maintenance: "점검중", standby: "예비", retired: "폐기",
};
const movementLabels: Record<string, string> = { bring_in: '반입', bring_out: '반출', return: '반납' };
const movementColors: Record<string, string> = { bring_in: 'text-ink', bring_out: 'text-warn', return: 'text-signal' };
const severityLabels: Record<string, string> = { critical: '심각', major: '주요', minor: '경미' };
const severityColors: Record<string, string> = { critical: 'text-fault bg-red-50', major: 'text-warn bg-amber-50', minor: 'text-ink-2 bg-slate-100' };



export default async function DashboardPage() {
  const stats = await getStats();
  const isAdmin = (await getSession())?.role === "admin";
  const today = new Date().toISOString().slice(0, 10);
  // 기준 시각 (외부 검토 P1-1 합의): 대시보드는 조회 시점 스냅샷 — 새로고침해야 갱신됨을 명시
  const asOf = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

  // 상태별 색상 맵
  const statusColors: Record<string, string> = {
    active: "bg-signal",
    maintenance: "bg-warn",
    standby: "bg-slate-400",
    retired: "bg-fault",
  };

  // 생명주기 프로세스 흐름: 각 단계에서 처리 대기 중인 작업 수와 이동 링크 (넛지)
  const statusCount = (s: string) => stats.byStatus.find((x: any) => x.status === s)?.c ?? 0;
  const dqx = stats.dataQuality || { no_ip: 0, no_rack: 0 };
  const lifecycleSteps = [
    { key: "bring_in", label: "반입", icon: ArrowDownToLine, count: stats.bringInPending, unit: "건", pendingLabel: "진행중", href: "/movements", pending: stats.bringInPending > 0 },
    { key: "rack", label: "랙 실장", icon: HardDrive, count: dqx.no_rack || 0, unit: "대", pendingLabel: "미실장", href: "/assets?missing=rack", pending: (dqx.no_rack || 0) > 0 },
    { key: "ip", label: "IP 부여", icon: Globe, count: dqx.no_ip || 0, unit: "대", pendingLabel: "미부여", href: "/assets?missing=ip", pending: (dqx.no_ip || 0) > 0 },
    { key: "operate", label: "운영", icon: Activity, count: statusCount("active"), unit: "대", pendingLabel: "운용중", href: "/assets", pending: false },
    { key: "bring_out", label: "반출", icon: ArrowUpFromLine, count: stats.bringOutInProgress, unit: "건", pendingLabel: "진행중", href: "/movements", pending: stats.bringOutInProgress > 0 },
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


  const portPct = stats.totalPorts > 0 ? Math.round((stats.usedPorts / stats.totalPorts) * 100) : 0;

  return (
    <div>
      {/* ── FACILITY STATUS 계기 바 (히어로) ───────────────────── */}
      <header className="panel mb-6 overflow-hidden">
        <div className="flex flex-wrap items-stretch">
          <div className="px-5 py-4 flex-1 min-w-[240px] border-b lg:border-b-0 lg:border-r border-line">
            <div className="flex items-center gap-2">
              <span className="led led-up led-live" />
              <span className="eyebrow">FACILITY STATUS · {today} <span className="normal-case">{asOf} 기준 — 새로고침 시 갱신</span></span>
            </div>
            <h2 className="mt-1.5 text-xl font-bold tracking-tight">운영 대시보드</h2>
            <p className="text-sm text-ink-2 mt-0.5">
              자산 <span className="num font-semibold text-ink">{stats.totalAssets}</span>대 ·
              랙 <span className="num font-semibold text-ink">{stats.totalRacks}</span>식 가동 중
            </p>
          </div>
          <Readout label="ASSETS" value={stats.totalAssets} unit="대" sub={`운용 ${stats.activeAssets}`} hint="전체 등록 장비 수(부속자산 제외, 폐기 포함). '운용'은 상태가 운용중인 장비." />
          <Readout label="RACKS" value={stats.totalRacks} unit="식" sub={`${stats.totalLocations} 위치`} hint="위치관리에 등록된 랙 수(전 위치 합계)." />
          <Readout label="PORTS" value={stats.totalPorts} unit="P" sub={`사용 ${stats.usedPorts}`} hint="스위치 포트맵에 등록된 포트 수. '사용'은 연결이 지정된 포트." />
          <Readout
            label="PORT UTIL"
            value={portPct}
            unit="%"
            sub={`${stats.usedPorts}/${stats.totalPorts}`}
            tone={portPct > 80 ? "fault" : portPct > 50 ? "warn" : "signal"}
          />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* 자산 유형별 */}
        <Panel title="자산 유형별 현황" code="TYPE">
          <div className="space-y-3">
            {stats.byType.map((t: any) => {
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

        {/* 랙 사용률 — 열(그룹) 단위 요약 후 펼침 (랙 57식 전체 나열 방지) */}
        <Panel title="랙 사용률" code="RACK·U">
          <div className="space-y-2">
            {(() => {
              const groups = new Map<string, any[]>();
              for (const r of stats.rackUsage) {
                const key = String(r.rack_name).match(/^([A-Za-z가-힣]+)[-_ ]?\d/)?.[1]?.toUpperCase() || "기타";
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(r);
              }
              return [...groups.entries()]
                .sort(([a], [b]) => (a === "기타" ? 1 : b === "기타" ? -1 : a.localeCompare(b)))
                .map(([key, racks]) => {
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
                      {racks.map((r: any) => {
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
              });
            })()}
          </div>
        </Panel>
      </div>

      {/* 부서별 / 관리자별 / OS별 — 도넛(구성비) + 범례(정확한 수치) 콤보, 상위 5 + 기타 묶음 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Panel title="팀별 자산" code="TEAM">
          <Donut items={stats.byTeam.map((d: any) => ({ label: d.team_name, value: d.c }))} />
        </Panel>
        <Panel title="관리자별 자산" code="ADMIN">
          <Donut items={stats.byAdmin.map((d: any) => ({ label: d.admin_name, value: d.c }))} />
        </Panel>
        <Panel title="OS / 펌웨어 분포" code="OS">
          <Donut items={stats.byOs.map((d: any) => ({ label: d.os, value: d.c }))} />
        </Panel>
      </div>

      {/* 패널 1: 상태별 자산 분포 */}
      <Panel title="상태별 자산 분포" code="STATUS" className="mb-5">
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

      {/* 패널 2: 생명주기 흐름 — 각 단계의 대기 작업을 눌러 바로 처리 (넛지) */}
      <Panel title="생명주기 흐름" code="LIFECYCLE" className="mb-5">
        <div className="flex items-center justify-between overflow-x-auto gap-1">
          {lifecycleSteps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={step.key} className="flex items-center">
                <Link href={step.href} className="flex flex-col items-center min-w-[88px] rounded-lg py-1.5 px-2 hover:bg-surface transition-colors group" title={`${step.label} — ${step.pendingLabel} ${step.count}${step.unit} 바로가기`}>
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center relative ${
                    step.pending ? "bg-amber-50 text-warn" : step.count > 0 ? "bg-slate-100 text-ink" : "bg-slate-50 text-ink-3"
                  }`}>
                    <Icon size={20} />
                    {step.pending && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-warn border-2 border-panel" />}
                  </div>
                  <span className="text-xs mt-1.5 text-ink-2 group-hover:text-ink">{step.label}</span>
                  <span className={`num text-sm font-bold ${step.pending ? "text-warn" : ""}`}>
                    {step.count}<span className="text-ink-3 text-xs ml-0.5">{step.unit}</span>
                  </span>
                  <span className={`text-[10px] ${step.pending ? "text-warn" : "text-ink-3"}`}>{step.pendingLabel}</span>
                </Link>
                {i < lifecycleSteps.length - 1 && (
                  <ChevronRight size={16} className="text-line-strong mx-1 shrink-0" />
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-ink-3 mt-2 border-t border-line pt-2">
          반입 → 실장 → IP 부여 → 운영 → 반출 순으로 흐릅니다. 주황 표시는 해당 단계에 처리 대기 작업이 있다는 뜻입니다 — 눌러서 바로 처리하세요.
          점검 <span className="num">{statusCount("maintenance")}</span> · 예비 <span className="num">{statusCount("standby")}</span> · 폐기 <span className="num">{statusCount("retired")}</span>
          {stats.pendingMovements > 0 && (
            <> · <Link href="/movements" className="text-warn hover:underline">승인 대기 반출입 <span className="num font-semibold">{stats.pendingMovements}</span>건 처리하기</Link></>
          )}
        </p>
        <p className="text-[10px] text-ink-3 mt-1">
          집계 기준: 반입/반출 = 진행중(신청·승인) 이동 건 · 미실장/미부여 = 폐기 제외 장비 중 랙 또는 대표 IP가 없는 것 · 운용중 = 상태값 기준
        </p>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* 패널 3: EoS/보증 경고 */}
        <Panel
          title="EoS / 보증만료 경고"
          code="EOS·WTY"
          icon={<AlertTriangle size={16} className="text-warn" />}
        >
          {allWarnings.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {allWarnings.map((w: any, i: number) => (
                <div key={`${w.warnType}-${w.id}-${i}`} className="flex items-center justify-between text-sm border-b border-line last:border-0 pb-2">
                  <div>
                    <span className="font-medium">{w.asset_name}</span>
                    <span className="text-xs text-ink-3 ml-2">{typeLabels[w.asset_type] || w.asset_type}</span>
                    <span className="eyebrow ml-2 !text-[0.625rem]">{w.warnType}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="num text-xs text-ink-2">{w.date}</span>
                    {dDayBadge(w.date)}
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

        {/* 패널 4: 데이터 품질 */}
        <Panel title="데이터 품질" code="DATA·Q">
          <div className="flex items-baseline gap-3 mb-4">
            <div className={`num text-4xl font-bold leading-none ${qualityScore >= 80 ? "text-signal" : qualityScore >= 50 ? "text-warn" : "text-fault"}`}>
              {qualityScore}<span className="text-xl">%</span>
            </div>
            <span className="eyebrow">전체 품질 점수</span>
          </div>
          <div className="space-y-3">
            {qualityItems.map((item) => {
              const pct = stats.totalAssets > 0 ? Math.round((item.count / stats.totalAssets) * 100) : 0;
              const isClean = item.count === 0;
              return (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {isClean ? (
                      <CheckCircle size={16} className="text-signal" />
                    ) : (
                      <AlertCircle size={16} className="text-warn" />
                    )}
                    <span>{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`num font-semibold ${isClean ? "text-signal" : "text-warn"}`}>{item.count}건</span>
                    <span className="num text-xs text-ink-3">({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* 정리 필요 큐 / 데이터 품질 (P6 · AC-2/13/14) */}
      <div className="mb-5">
        <div className="flex items-baseline gap-2 mb-3">
          <span className="eyebrow">CLEANUP · 정리 필요 큐</span>
          <span className="num text-base font-bold text-ink">{stats.cleanupCount}</span>
          <span className="text-sm text-ink-3">건 정리 필요</span>
          {isAdmin && (
            <Link href="/import-issues" className="text-xs text-signal hover:underline ml-2">이슈 처리 화면 →</Link>
          )}
        </div>
        {/* 가져오기 이슈 유형별 카드 */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          {[
            { label: "오류", count: stats.issueSummary.error, tone: "text-fault" },
            { label: "식별자 없음", count: stats.issueSummary.missing_id, tone: "text-warn" },
            { label: "OS 미입력", count: stats.issueSummary.missing_os, tone: "text-warn" },
            { label: "중복 의심", count: stats.issueSummary.dup_suspect, tone: "text-warn" },
            { label: "중복 그룹(동명이기)", count: stats.dupSuspect.groups, tone: "text-ink-2" },
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
            {stats.cleanupCount === 0 ? (
              <p className="text-ink-3 text-sm">정리할 자산이 없습니다.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {stats.cleanupQueue.map((q: any) => (
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
                실장 충돌 <span className={`num text-base font-bold ml-1 ${stats.rackConflicts.conflicts.length > 0 ? "text-fault" : "text-ink"}`}>{stats.rackConflicts.conflicts.length}</span>
                <span className="mx-1">·</span>범위초과 <span className={`num text-base font-bold ml-1 ${stats.rackConflicts.overflows.length > 0 ? "text-warn" : "text-ink"}`}>{stats.rackConflicts.overflows.length}</span>
              </p>
              {stats.rackConflicts.conflicts.length === 0 && stats.rackConflicts.overflows.length === 0 ? (
                <p className="text-ink-3 text-sm">랙 배치 이상 없음</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {stats.rackConflicts.conflicts.map((c, i) => (
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
                  {stats.rackConflicts.overflows.map((o, i) => (
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
              그룹 <span className="num text-base font-bold text-ink ml-1">{stats.dupSuspect.groups}</span> · 의심 자산
              <span className="num text-base font-bold text-ink ml-1">{stats.dupSuspect.assets}</span> · 진성 중복 후보
              <span className="num text-base font-bold text-fault ml-1">{stats.dupSuspect.likelyDup}</span>
            </p>
            {stats.dupSuspect.topGroups.length === 0 ? (
              <p className="text-ink-3 text-sm">중복 의심 없음</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {stats.dupSuspect.topGroups.map((g: any, i: number) => {
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
            {stats.byTeam.length === 0 ? (
              <p className="text-ink-3 text-sm">자산 없음</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {stats.byTeam.map((t: any, i: number) => (
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

      {/* 운영 현황 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        {/* 반입/반출 */}
        <Panel
          title="반입/반출"
          code="I/O"
          icon={<ArrowLeftRight size={16} className="text-ink-2" />}
        >
          <p className="eyebrow mb-3">대기 승인 <span className="num text-base font-bold text-ink ml-1">{stats.pendingMovements}</span> 건</p>
          {stats.recentMovements.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {stats.recentMovements.map((m: any, i: number) => (
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

        {/* 유지보수/장애 */}
        <Panel
          title="유지보수/장애"
          code="MAINT"
          icon={<Wrench size={16} className="text-warn" />}
        >
          <p className="eyebrow mb-3">미해결 <span className="num text-base font-bold text-warn ml-1">{stats.openMaintenance}</span> 건</p>
          {stats.recentMaintenance.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {stats.recentMaintenance.map((ml: any, i: number) => (
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

        {/* 계약 만료 임박 */}
        <Panel
          title="계약 만료 임박"
          code="SLA"
          icon={<FileText size={16} className="text-fault" />}
        >
          {stats.expiringContracts.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {stats.expiringContracts.map((c: any, i: number) => {
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
      </div>

      {/* 최근 등록 자산 */}
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
            {stats.recentAssets.map((a: any) => (
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
    </div>
  );
}

/* ── 계기 패널 ─────────────────────────────────────────────── */
function Panel({
  title, code, icon, children, className = "",
}: {
  title: string; code?: string; icon?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          {icon}
          {title}
        </div>
        {code && <span className="eyebrow">{code}</span>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

/* ── 도넛 차트 (순수 SVG, 외부 의존성 없음) ─────────────────
   파이/도넛은 조각이 많으면 판독 불능 → 상위 5 + '기타' 자동 묶음.
   구성비는 도넛이, 정확한 수치는 우측 범례가 담당한다. */
const DONUT_COLORS = ["#334155", "#16a34a", "#d97706", "#6366f1", "#dc2626", "#94a3b8"];
function Donut({ items, unit = "대" }: { items: { label: string; value: number }[]; unit?: string }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return <p className="text-ink-3 text-sm">데이터 없음</p>;
  const top = items.slice(0, 5);
  const restCount = items.length - top.length;
  const rest = items.slice(5).reduce((s, i) => s + i.value, 0);
  const slices = rest > 0 ? [...top, { label: `기타 ${restCount}종`, value: rest }] : top;
  let offset = 25; // 12시 방향에서 시작
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 42 42" className="w-28 h-28 shrink-0" role="img" aria-label="구성비 도넛 차트">
        {slices.map((s, i) => {
          const pct = (s.value / total) * 100;
          const el = (
            <circle key={s.label} cx="21" cy="21" r="15.915" fill="transparent"
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]} strokeWidth="6"
              strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={offset}>
              <title>{`${s.label}: ${s.value}${unit} (${Math.round(pct)}%)`}</title>
            </circle>
          );
          offset -= pct;
          return el;
        })}
        <text x="21" y="20.5" textAnchor="middle" style={{ font: "bold 7px var(--font-num, sans-serif)", fill: "currentColor" }}>{total}</text>
        <text x="21" y="27" textAnchor="middle" style={{ font: "3.5px sans-serif", fill: "#94a3b8" }}>총 {unit === "대" ? "자산" : unit}</text>
      </svg>
      <div className="space-y-1.5 min-w-0 flex-1">
        {slices.map((s, i) => {
          const pct = Math.round((s.value / total) * 100);
          return (
            <div key={s.label} className="flex items-center gap-2 text-sm">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }} />
              <span className="truncate flex-1" title={s.label}>{s.label}</span>
              <span className="num font-semibold shrink-0">{s.value}<span className="text-ink-3 text-xs">{unit}</span></span>
              <span className="num text-xs text-ink-3 w-9 text-right shrink-0">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── 계기 readout (히어로 바이탈) ─────────────────────────── */
function Readout({
  label, value, unit, sub, tone = "ink", hint,
}: {
  label: string; value: string | number; unit?: string; sub?: string;
  tone?: "ink" | "signal" | "warn" | "fault";
  /** 집계 기준 설명 — 카드 hover 시 노출 (외부 검토 P1-1 합의: 수치 의미 오해 방지) */
  hint?: string;
}) {
  const toneClass =
    tone === "signal" ? "text-signal" : tone === "warn" ? "text-warn" : tone === "fault" ? "text-fault" : "text-ink";
  return (
    <div className="px-5 py-4 flex-1 min-w-[140px] border-b sm:border-b-0 sm:border-r last:border-r-0 border-line" title={hint} style={hint ? { cursor: "help" } : undefined}>
      <p className="eyebrow">{label}</p>
      <p className={`num text-2xl font-bold mt-1 leading-none ${toneClass}`}>
        {value}
        {unit && <span className="text-sm text-ink-3 ml-0.5 font-medium">{unit}</span>}
      </p>
      {sub && <p className="num text-xs text-ink-2 mt-1.5">{sub}</p>}
    </div>
  );
}

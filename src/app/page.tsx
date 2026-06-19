import { getDb } from "@/lib/db";
import {
  Server, Network, Shield, Phone, Cable,
  AlertTriangle, AlertCircle, CheckCircle, ChevronRight, Package, Activity, Wrench, XCircle, Archive,
  ArrowLeftRight, FileText,
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
  // 반입/반출 현황
  const pendingMovements = (db.prepare("SELECT COUNT(*) as c FROM asset_movements WHERE status='requested'").get() as any).c;
  const recentMovements = db.prepare(
    "SELECT m.*, a.asset_name FROM asset_movements m LEFT JOIN assets a ON m.asset_id = a.id ORDER BY m.created_at DESC LIMIT 5"
  ).all() as any[];

  // 유지보수 현황
  const openMaintenance = (db.prepare("SELECT COUNT(*) as c FROM maintenance_logs WHERE status IN ('open','in_progress')").get() as any).c;
  const recentMaintenance = db.prepare(
    "SELECT ml.*, a.asset_name FROM maintenance_logs ml LEFT JOIN assets a ON ml.asset_id = a.id ORDER BY ml.created_at DESC LIMIT 5"
  ).all() as any[];

  // 계약 만료 현황
  const expiringContracts = db.prepare(
    `SELECT c.*, v.vendor_name FROM contracts c LEFT JOIN vendors v ON c.vendor_id = v.id
     WHERE c.status = 'active' AND c.end_date != '' AND c.end_date <= ? ORDER BY c.end_date LIMIT 5`
  ).all(days90) as any[];


  return {
    totalAssets, byType, activeAssets, totalRacks, totalPorts, usedPorts,
    totalLocations, rackUsage, recentAssets, byDepartment, byAdmin, byOs,
    byStatus, eosWarnings, warrantyWarnings, dataQuality,
    pendingMovements, recentMovements, openMaintenance, recentMaintenance, expiringContracts,
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
  active: "운용중", inactive: "미사용", maintenance: "점검중", decommissioned: "폐기", eos: "EoS(단종)",
};
const movementLabels: Record<string, string> = { bring_in: '반입', bring_out: '반출', return: '반납' };
const movementColors: Record<string, string> = { bring_in: 'text-ink', bring_out: 'text-warn', return: 'text-signal' };
const severityLabels: Record<string, string> = { critical: '심각', major: '주요', minor: '경미' };
const severityColors: Record<string, string> = { critical: 'text-fault bg-red-50', major: 'text-warn bg-amber-50', minor: 'text-ink-2 bg-slate-100' };



export default function DashboardPage() {
  const stats = getStats();
  const today = new Date().toISOString().slice(0, 10);

  // 상태별 색상 맵
  const statusColors: Record<string, string> = {
    active: "bg-signal",
    inactive: "bg-slate-400",
    maintenance: "bg-warn",
    eos: "bg-fault",
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


  const portPct = stats.totalPorts > 0 ? Math.round((stats.usedPorts / stats.totalPorts) * 100) : 0;

  return (
    <div>
      {/* ── FACILITY STATUS 계기 바 (히어로) ───────────────────── */}
      <header className="panel mb-6 overflow-hidden">
        <div className="flex flex-wrap items-stretch">
          <div className="px-5 py-4 flex-1 min-w-[240px] border-b lg:border-b-0 lg:border-r border-line">
            <div className="flex items-center gap-2">
              <span className="led led-up led-live" />
              <span className="eyebrow">FACILITY STATUS · {today}</span>
            </div>
            <h2 className="mt-1.5 text-xl font-bold tracking-tight">운영 대시보드</h2>
            <p className="text-sm text-ink-2 mt-0.5">
              자산 <span className="num font-semibold text-ink">{stats.totalAssets}</span>대 ·
              랙 <span className="num font-semibold text-ink">{stats.totalRacks}</span>식 가동 중
            </p>
          </div>
          <Readout label="ASSETS" value={stats.totalAssets} unit="대" sub={`운용 ${stats.activeAssets}`} />
          <Readout label="RACKS" value={stats.totalRacks} unit="식" sub={`${stats.totalLocations} 위치`} />
          <Readout label="PORTS" value={stats.totalPorts} unit="P" sub={`사용 ${stats.usedPorts}`} />
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
                    <div className={`w-8 h-8 rounded flex items-center justify-center ${typeColors[t.asset_type]}`}>
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
          <div className="space-y-3.5">
            {stats.rackUsage.map((r: any) => {
              const pct = Math.round((r.used_units / r.total_units) * 100);
              return (
                <div key={r.id}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span>{r.rack_name}</span>
                    <span className="num text-ink-2">{r.used_units}U / {r.total_units}U <span className="text-ink-3">({pct}%)</span></span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${pct > 80 ? "bg-fault" : pct > 50 ? "bg-warn" : "bg-signal"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* 부서별 / 관리자별 / OS별 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Panel title="부서별 자산" code="DEPT">
          <div className="space-y-2">
            {stats.byDepartment.map((d: any) => (
              <div key={d.department} className="flex items-center justify-between text-sm">
                <span>{d.department}</span>
                <span className="num font-semibold">{d.c}<span className="text-ink-3 text-xs ml-0.5">대</span></span>
              </div>
            ))}
            {stats.byDepartment.length === 0 && <p className="text-ink-3 text-sm">데이터 없음</p>}
          </div>
        </Panel>
        <Panel title="관리자별 자산" code="ADMIN">
          <div className="space-y-2">
            {stats.byAdmin.map((d: any) => (
              <div key={d.admin_name} className="flex items-center justify-between text-sm">
                <span>{d.admin_name}</span>
                <span className="num font-semibold">{d.c}<span className="text-ink-3 text-xs ml-0.5">대</span></span>
              </div>
            ))}
            {stats.byAdmin.length === 0 && <p className="text-ink-3 text-sm">데이터 없음</p>}
          </div>
        </Panel>
        <Panel title="OS / 펌웨어 분포" code="OS">
          <div className="space-y-2">
            {stats.byOs.map((d: any) => (
              <div key={d.os} className="flex items-center justify-between text-sm">
                <span className="truncate mr-2">{d.os}</span>
                <span className="num font-semibold shrink-0">{d.c}<span className="text-ink-3 text-xs ml-0.5">대</span></span>
              </div>
            ))}
            {stats.byOs.length === 0 && <p className="text-ink-3 text-sm">데이터 없음</p>}
          </div>
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

      {/* 패널 2: 생명주기 흐름 */}
      <Panel title="생명주기 흐름" code="LIFECYCLE" className="mb-5">
        <div className="flex items-center justify-between overflow-x-auto gap-1">
          {lifecycleSteps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={step.key} className="flex items-center">
                <div className="flex flex-col items-center min-w-[80px]">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    step.count > 0 ? "bg-slate-100 text-ink" : "bg-slate-50 text-ink-3"
                  }`}>
                    <Icon size={20} />
                  </div>
                  <span className="text-xs mt-1.5 text-ink-2">{step.label}</span>
                  <span className="num text-sm font-bold">{step.count}<span className="text-ink-3 text-xs ml-0.5">대</span></span>
                </div>
                {i < lifecycleSteps.length - 1 && (
                  <ChevronRight size={16} className="text-line-strong mx-1 shrink-0" />
                )}
              </div>
            );
          })}
        </div>
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
                  <span className={`text-xs px-2 py-0.5 rounded ${typeColors[a.asset_type]}`}>
                    {typeLabels[a.asset_type]}
                  </span>
                </td>
                <td className="py-2 num text-ink-2 text-xs">{a.ip_address}</td>
                <td className="py-2 text-ink-2 text-xs">{a.os || "-"}</td>
                <td className="py-2 text-ink-2 text-xs">{a.admin_name || "-"}</td>
                <td className="py-2 text-ink-2 text-xs">{a.department || "-"}</td>
                <td className="py-2">
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span className={`led ${a.status === "active" ? "led-up" : a.status === "maintenance" ? "led-warn" : a.status === "eos" ? "led-fault" : "led-idle"}`} />
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

/* ── 계기 readout (히어로 바이탈) ─────────────────────────── */
function Readout({
  label, value, unit, sub, tone = "ink",
}: {
  label: string; value: string | number; unit?: string; sub?: string;
  tone?: "ink" | "signal" | "warn" | "fault";
}) {
  const toneClass =
    tone === "signal" ? "text-signal" : tone === "warn" ? "text-warn" : tone === "fault" ? "text-fault" : "text-ink";
  return (
    <div className="px-5 py-4 flex-1 min-w-[140px] border-b sm:border-b-0 sm:border-r last:border-r-0 border-line">
      <p className="eyebrow">{label}</p>
      <p className={`num text-2xl font-bold mt-1 leading-none ${toneClass}`}>
        {value}
        {unit && <span className="text-sm text-ink-3 ml-0.5 font-medium">{unit}</span>}
      </p>
      {sub && <p className="num text-xs text-ink-2 mt-1.5">{sub}</p>}
    </div>
  );
}

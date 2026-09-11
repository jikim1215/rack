export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { requireMenuPage } from "@/lib/page-authz";
import { getDashboardStats } from "@/lib/dashboard-stats";
import Readout from "@/components/dashboard/Readout";
import Panel from "@/components/dashboard/Panel";
import Donut from "@/components/dashboard/Donut";
import TypeUsagePanel from "@/components/dashboard/TypeUsagePanel";
import StatusPanel from "@/components/dashboard/StatusPanel";
import LifecyclePanel from "@/components/dashboard/LifecyclePanel";
import WarningsPanel from "@/components/dashboard/WarningsPanel";
import QualityPanel from "@/components/dashboard/QualityPanel";
import CleanupPanel from "@/components/dashboard/CleanupPanel";
import { MovementsPanel, MaintenancePanel, ContractsPanel, RecentAssetsPanel } from "@/components/dashboard/ActivityPanels";

export default async function DashboardPage() {
  // 대시보드는 고정 접근 메뉴이지만 perms 를 실은 actor 를 써서 다른 페이지와 같은 경로로 인가한다(비평 반영)
  const actor = await requireMenuPage("dashboard");
  const isAdmin = actor.role === "admin";
  const stats = getDashboardStats(getDb(), actor);
  const today = new Date().toISOString().slice(0, 10);
  // 기준 시각 (외부 검토 P1-1 합의): 대시보드는 조회 시점 스냅샷 — 새로고침해야 갱신됨을 명시
  const asOf = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

  const statusCount = (s: string) => stats.byStatus.find((x) => x.status === s)?.c ?? 0;
  const dqx = stats.dataQuality || { no_ip: 0, no_rack: 0 };

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

      <TypeUsagePanel byType={stats.byType} rackUsage={stats.rackUsage} />

      {/* 팀별 / 관리자별 / OS별 — 도넛(구성비) + 범례(정확한 수치) 콤보, 상위 5 + 기타 묶음 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <Panel title="팀별 자산" code="TEAM">
          <Donut items={stats.byTeam.map((d) => ({ label: d.team_name, value: d.c }))} />
        </Panel>
        <Panel title="관리자별 자산" code="ADMIN">
          <Donut items={stats.byAdmin.map((d) => ({ label: d.admin_name, value: d.c }))} />
        </Panel>
        <Panel title="OS / 펌웨어 분포" code="OS">
          <Donut items={stats.byOs.map((d) => ({ label: d.os, value: d.c }))} />
        </Panel>
      </div>

      <StatusPanel totalAssets={stats.totalAssets} byStatus={stats.byStatus} />

      <LifecyclePanel
        bringInPending={stats.bringInPending}
        bringOutInProgress={stats.bringOutInProgress}
        noRack={dqx.no_rack || 0}
        noIp={dqx.no_ip || 0}
        activeCount={statusCount("active")}
        maintenanceCount={statusCount("maintenance")}
        standbyCount={statusCount("standby")}
        retiredCount={statusCount("retired")}
        pendingMovements={stats.pendingMovements}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <WarningsPanel eosWarnings={stats.eosWarnings} warrantyWarnings={stats.warrantyWarnings} today={today} />
        <QualityPanel totalAssets={stats.totalAssets} dataQuality={stats.dataQuality} />
      </div>

      <CleanupPanel
        isAdmin={isAdmin}
        cleanupCount={stats.cleanupCount}
        issueSummary={stats.issueSummary}
        cleanupQueue={stats.cleanupQueue}
        dupSuspect={stats.dupSuspect}
        rackConflicts={stats.rackConflicts}
        byTeam={stats.byTeam}
      />

      {/* 운영 현황 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <MovementsPanel pendingMovements={stats.pendingMovements} recentMovements={stats.recentMovements} />
        <MaintenancePanel openMaintenance={stats.openMaintenance} recentMaintenance={stats.recentMaintenance} />
        <ContractsPanel expiringContracts={stats.expiringContracts} today={today} />
      </div>

      <RecentAssetsPanel recentAssets={stats.recentAssets} />
    </div>
  );
}

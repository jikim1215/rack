// ── 생명주기 흐름 패널 — 각 단계의 대기 작업을 눌러 바로 처리 (넛지) ──
import Link from "next/link";
import { ChevronRight, Activity, ArrowDownToLine, ArrowUpFromLine, HardDrive, Globe } from "lucide-react";
import Panel from "./Panel";

export default function LifecyclePanel({
  bringInPending, bringOutInProgress, noRack, noIp, activeCount, maintenanceCount, standbyCount, retiredCount, pendingMovements,
}: {
  bringInPending: number;
  bringOutInProgress: number;
  noRack: number;
  noIp: number;
  activeCount: number;
  maintenanceCount: number;
  standbyCount: number;
  retiredCount: number;
  pendingMovements: number;
}) {
  const lifecycleSteps = [
    { key: "bring_in", label: "반입", icon: ArrowDownToLine, count: bringInPending, unit: "건", pendingLabel: "진행중", href: "/movements", pending: bringInPending > 0 },
    { key: "rack", label: "랙 실장", icon: HardDrive, count: noRack, unit: "대", pendingLabel: "미실장", href: "/assets?missing=rack", pending: noRack > 0 },
    { key: "ip", label: "IP 부여", icon: Globe, count: noIp, unit: "대", pendingLabel: "미부여", href: "/assets?missing=ip", pending: noIp > 0 },
    { key: "operate", label: "운영", icon: Activity, count: activeCount, unit: "대", pendingLabel: "운용중", href: "/assets", pending: false },
    { key: "bring_out", label: "반출", icon: ArrowUpFromLine, count: bringOutInProgress, unit: "건", pendingLabel: "진행중", href: "/movements", pending: bringOutInProgress > 0 },
  ];

  return (
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
        점검 <span className="num">{maintenanceCount}</span> · 예비 <span className="num">{standbyCount}</span> · 폐기 <span className="num">{retiredCount}</span>
        {pendingMovements > 0 && (
          <> · <Link href="/movements" className="text-warn hover:underline">승인 대기 반출입 <span className="num font-semibold">{pendingMovements}</span>건 처리하기</Link></>
        )}
      </p>
      <p className="text-[10px] text-ink-3 mt-1">
        집계 기준: 반입/반출 = 진행중(신청·승인) 이동 건 · 미실장/미부여 = 폐기 제외 장비 중 랙 또는 대표 IP가 없는 것 · 운용중 = 상태값 기준
      </p>
    </Panel>
  );
}

"use client";

// 유지보수 페이지 최상위: 탭 바 + activeTab 상태만 관리하고, 실제 화면은 tabs/* 에 위임한다.
import { useState } from "react";
import { Coins, ListChecks } from "lucide-react";
import { LogsTab } from "./tabs/LogsTab";
import { TargetsTab } from "./tabs/TargetsTab";
import type { AssetOption, Log, Target, VendorOption } from "./tabs/types";

interface Props {
  logs: Log[];
  targets: Target[];
  assets: AssetOption[];
  vendors: VendorOption[];
}

export default function MaintenanceView({ logs: initialLogs, targets: initialTargets, assets, vendors }: Props) {
  const [tab, setTab] = useState<"logs" | "targets">("logs");
  const [logs, setLogs] = useState(initialLogs);
  const [targets, setTargets] = useState(initialTargets);

  return (
    <div className="space-y-4">
      {/* 탭 */}
      <div className="flex border-b border-line">
        <button
          onClick={() => setTab("logs")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "logs" ? "border-signal text-ink" : "border-transparent text-ink-2 hover:text-ink"
          }`}
        >
          <span className="flex items-center gap-1.5"><ListChecks size={16} /> 유지관리내역</span>
        </button>
        <button
          onClick={() => setTab("targets")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "targets" ? "border-signal text-ink" : "border-transparent text-ink-2 hover:text-ink"
          }`}
        >
          <span className="flex items-center gap-1.5"><Coins size={16} /> 유지관리 대상/금액</span>
        </button>
      </div>

      {/* 탭은 상시 마운트하고 hidden 으로 토글해, 전환 시에도 각 탭의 로컬 state(검색어/필터/폼)를 보존한다. */}
      <div className={tab === "logs" ? "" : "hidden"}>
        <LogsTab logs={logs} onLogsChange={setLogs} assets={assets} vendors={vendors} />
      </div>
      <div className={tab === "targets" ? "" : "hidden"}>
        <TargetsTab targets={targets} onTargetsChange={setTargets} assets={assets} />
      </div>
    </div>
  );
}

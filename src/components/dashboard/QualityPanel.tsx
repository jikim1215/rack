// ── 데이터 품질 패널 ──
import { AlertCircle, CheckCircle } from "lucide-react";
import Panel from "./Panel";

export default function QualityPanel({
  totalAssets, dataQuality,
}: {
  totalAssets: number;
  dataQuality: { no_ip: number | null; no_admin: number | null; no_rack: number | null; no_os: number | null } | null;
}) {
  // 데이터 품질 점수
  const dq = dataQuality || { no_ip: 0, no_admin: 0, no_rack: 0, no_os: 0 };
  const totalDefects = (dq.no_ip || 0) + (dq.no_admin || 0) + (dq.no_rack || 0) + (dq.no_os || 0);
  const qualityScore = totalAssets > 0
    ? Math.round((1 - totalDefects / (totalAssets * 4)) * 100)
    : 100;
  const qualityItems = [
    { label: "IP 미입력", count: dq.no_ip || 0, icon: AlertCircle },
    { label: "관리자 미지정", count: dq.no_admin || 0, icon: AlertCircle },
    { label: "랙 미배치", count: dq.no_rack || 0, icon: AlertCircle },
    { label: "OS 미입력", count: dq.no_os || 0, icon: AlertCircle },
  ];

  return (
    <Panel title="데이터 품질" code="DATA·Q">
      <div className="flex items-baseline gap-3 mb-4">
        <div className={`num text-4xl font-bold leading-none ${qualityScore >= 80 ? "text-signal" : qualityScore >= 50 ? "text-warn" : "text-fault"}`}>
          {qualityScore}<span className="text-xl">%</span>
        </div>
        <span className="eyebrow">전체 품질 점수</span>
      </div>
      <div className="space-y-3">
        {qualityItems.map((item) => {
          const pct = totalAssets > 0 ? Math.round((item.count / totalAssets) * 100) : 0;
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
  );
}

// ── 계기 readout (히어로 바이탈) ─────────────────────────
export default function Readout({
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

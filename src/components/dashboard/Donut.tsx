// ── 도넛 차트 (순수 SVG, 외부 의존성 없음) ─────────────────
// 파이/도넛은 조각이 많으면 판독 불능 → 상위 5 + '기타' 자동 묶음.
// 구성비는 도넛이, 정확한 수치는 우측 범례가 담당한다.
const DONUT_COLORS = ["#334155", "#16a34a", "#d97706", "#6366f1", "#dc2626", "#94a3b8"];

export default function Donut({ items, unit = "대" }: { items: { label: string; value: number }[]; unit?: string }) {
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

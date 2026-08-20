"use client";

import { Printer } from "lucide-react";
import { UsageGuide } from "@/components/UsageGuide";

const typeLabels: Record<string, string> = {
  server: "서버", network: "네트워크", security: "정보보호", telecom: "전화설비", vm: "가상머신", other: "기타",
};
const statusLabels: Record<string, string> = {
  active: "운용중", maintenance: "점검중", standby: "예비", retired: "폐기",
};
const gradeLabels: Record<string, string> = { H: "상(H)", M: "중(M)", L: "하(L)", 미평가: "미평가" };

export function ReportView({ byTypeStatus, byTeam, byLocation, byCia, byYear, totals, asOf }: {
  byTypeStatus: { asset_type: string; status: string; c: number }[];
  byTeam: any[];
  byLocation: any[];
  byCia: { grade: string; c: number }[];
  byYear: { y: string; c: number }[];
  totals: { assets: number; subs: number; racks: number; frames: number };
  asOf: string;
}) {
  // 표준 6종 중 데이터가 있는 것 + 독립 부서 자체 유형(enum 밖)까지 모두 행으로 포함(ADR-011 확장).
  const knownTypes = Object.keys(typeLabels).filter((t) => byTypeStatus.some((r) => r.asset_type === t));
  const customTypes = [...new Set(byTypeStatus.map((r) => r.asset_type))].filter((t) => t && !typeLabels[t]);
  const types = [...knownTypes, ...customTypes];
  const statuses = Object.keys(statusLabels);
  const cell = (t: string, s: string) => byTypeStatus.find((r) => r.asset_type === t && r.status === s)?.c ?? 0;
  const typeTotal = (t: string) => byTypeStatus.filter((r) => r.asset_type === t).reduce((a, r) => a + r.c, 0);
  const statusTotal = (s: string) => byTypeStatus.filter((r) => r.status === s).reduce((a, r) => a + r.c, 0);

  const th = "border border-line px-3 py-1.5 text-left text-xs font-semibold bg-slate-50";
  const td = "border border-line px-3 py-1.5 text-sm";
  const tdNum = `${td} num text-right`;

  return (
    <div className="print:text-black">
      <style>{`@media print { .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>
      <div className="flex items-center justify-between mb-2 no-print">
        <div>
          <span className="eyebrow">REPORTS</span>
          <h2 className="text-2xl font-bold tracking-tight">통계 리포트</h2>
          <p className="text-sm text-ink-3 mt-1">심의·감사·보고 제출용 집계표입니다. 모든 수치는 조회 시점 기준입니다.</p>
        </div>
        <button onClick={() => window.print()} className="btn-ink px-4 py-2 text-sm flex items-center gap-1.5">
          <Printer size={15} /> 인쇄
        </button>
      </div>
      <UsageGuide
        className="mb-4 text-right no-print"
        items={[
          <>인쇄 버튼(또는 Ctrl+P)으로 <strong className="text-ink-2">종이/PDF 보고서</strong>를 만듭니다 — 화면 장식 없이 표만 출력됩니다</>,
          <>수치는 <strong className="text-ink-2">권한 범위 기준</strong>입니다 — 팀 계정은 자기 팀 자산만 집계됩니다</>,
          <>세부 목록이 필요하면 자산관리의 <strong className="text-ink-2">관리대장(제출용)</strong> 내보내기를 함께 사용하세요</>,
        ]}
      />

      {/* 표지 정보 */}
      <div className="mb-5 text-sm">
        <h1 className="hidden print:block text-xl font-bold mb-1">정보시스템 자산현황 보고</h1>
        <p className="text-ink-2">기준 시각: <span className="num">{asOf}</span> · 장비 <span className="num font-semibold">{totals.assets}</span>대 · 부속 <span className="num font-semibold">{totals.subs}</span>점 · 랙 <span className="num font-semibold">{totals.racks}</span>식 · 배선반 <span className="num font-semibold">{totals.frames}</span>식</p>
      </div>

      <div className="space-y-6">
        {/* 1. 유형 × 상태 */}
        <section>
          <h3 className="font-semibold mb-2 text-ink">1. 자산 유형 × 상태</h3>
          <table className="border-collapse w-full max-w-2xl">
            <thead><tr>
              <th className={th}>유형</th>
              {statuses.map((s) => <th key={s} className={th}>{statusLabels[s]}</th>)}
              <th className={th}>계</th>
            </tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t}>
                  <td className={td}>{typeLabels[t] || t}</td>
                  {statuses.map((s) => <td key={s} className={tdNum}>{cell(t, s) || "-"}</td>)}
                  <td className={`${tdNum} font-semibold`}>{typeTotal(t)}</td>
                </tr>
              ))}
              <tr>
                <td className={`${td} font-semibold bg-slate-50`}>계</td>
                {statuses.map((s) => <td key={s} className={`${tdNum} font-semibold bg-slate-50`}>{statusTotal(s) || "-"}</td>)}
                <td className={`${tdNum} font-bold bg-slate-50`}>{totals.assets}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* 2. 팀별 */}
        <section>
          <h3 className="font-semibold mb-2 text-ink">2. 관리부서(팀)별 현황</h3>
          <table className="border-collapse w-full max-w-2xl">
            <thead><tr>
              <th className={th}>팀</th><th className={th}>장비</th><th className={th}>랙 실장</th><th className={th}>IP 보유</th><th className={th}>부속자산</th>
            </tr></thead>
            <tbody>
              {byTeam.map((r) => (
                <tr key={r.team_name}>
                  <td className={td}>{r.team_name}</td>
                  <td className={tdNum}>{r.assets}</td>
                  <td className={tdNum}>{r.racked}</td>
                  <td className={tdNum}>{r.with_ip}</td>
                  <td className={tdNum}>{r.subs ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* 3. 위치·랙 */}
        <section>
          <h3 className="font-semibold mb-2 text-ink">3. 위치별 랙 사용률</h3>
          <table className="border-collapse w-full max-w-2xl">
            <thead><tr>
              <th className={th}>위치</th><th className={th}>랙 수</th><th className={th}>총 용량(U)</th><th className={th}>사용(U)</th><th className={th}>사용률</th>
            </tr></thead>
            <tbody>
              {byLocation.map((r) => (
                <tr key={r.location_name}>
                  <td className={td}>{r.location_name}</td>
                  <td className={tdNum}>{r.racks}</td>
                  <td className={tdNum}>{r.total_units}</td>
                  <td className={tdNum}>{r.used_units}</td>
                  <td className={tdNum}>{r.total_units > 0 ? Math.round((r.used_units / r.total_units) * 100) + "%" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* 4+5. 등급/연도 — 나란히 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
          <section>
            <h3 className="font-semibold mb-2 text-ink">4. 중요도(CIA) 등급 분포</h3>
            <table className="border-collapse w-full">
              <thead><tr><th className={th}>등급</th><th className={th}>대수</th></tr></thead>
              <tbody>
                {["H", "M", "L", "미평가"].map((g) => {
                  const c = byCia.find((r) => r.grade === g)?.c ?? 0;
                  return <tr key={g}><td className={td}>{gradeLabels[g]}</td><td className={tdNum}>{c}</td></tr>;
                })}
              </tbody>
            </table>
          </section>
          <section>
            <h3 className="font-semibold mb-2 text-ink">5. 도입 연도별 (구매일 기준)</h3>
            <table className="border-collapse w-full">
              <thead><tr><th className={th}>연도</th><th className={th}>대수</th></tr></thead>
              <tbody>
                {byYear.slice(0, 12).map((r) => {
                  const isYear = /^\d{4}$/.test(r.y);
                  return (
                    <tr key={r.y}>
                      <td className={isYear ? `${td} num` : `${td} text-ink-3`}>{isYear ? r.y : "구매일 미상"}</td>
                      <td className={tdNum}>{r.c}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}

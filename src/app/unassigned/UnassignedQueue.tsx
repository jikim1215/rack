"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Check, Sparkles, Building2 } from "lucide-react";
import { suggestTeam } from "@/lib/team-mapping";
import { useToast } from "@/components/Toast";
import { UsageGuide } from "@/components/UsageGuide";

interface Asset {
  id: number;
  asset_name: string;
  asset_type: string;
  ip_address: string;
  status: string;
  department: string;
  admin_name: string;
  os: string;
  rack_name: string | null;
  location_name: string | null;
}

interface Team {
  id: number;
  team_name: string;
}

interface DepartmentSummary {
  department: string;
  count: number;
}

interface Props {
  assets: Asset[];
  teams: Team[];
  departmentSummary: DepartmentSummary[];
}

const typeLabels: Record<string, string> = {
  server: "서버",
  network: "네트워크",
  security: "정보보호",
  telecom: "전화설비",
  vm: "가상머신",
  other: "기타",
};

const guideItems = [
  "소속 팀이 지정되지 않은 자산(team_id IS NULL)을 관리자(admin)가 특정 팀에 재배정합니다.",
  "부서별 일괄 배정: 자산의 부서명과 팀명을 정규화하여 팀을 자동 추천(완전일치 → 포함)합니다. 행별 [배정] 또는 전체 [추천된 부서 일괄 배정]을 클릭하세요.",
  "목록 선택 재배정: 개별 자산의 체크박스를 선택 후 팀을 지정하여 일괄 배정할 수도 있습니다.",
];

export function UnassignedQueue({ assets, teams, departmentSummary }: Props) {
  const router = useRouter();
  const { addToast } = useToast();

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [teamId, setTeamId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // 부서별 팀 선택 사용자 지정 상태
  const [deptSelections, setDeptSelections] = useState<Record<string, string>>({});

  function getSelectedTeam(dept: string): string {
    if (dept in deptSelections) {
      return deptSelections[dept];
    }
    if (!dept || !dept.trim()) return "";
    const suggested = suggestTeam(dept, teams);
    return suggested ? String(suggested) : "";
  }

  const allSelected = assets.length > 0 && selected.size === assets.length;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(assets.map((a) => a.id)));
  }

  async function handleBulkDeptReassign() {
    const payload = departmentSummary
      .map((d) => ({
        department: d.department,
        team_id: Number(getSelectedTeam(d.department)),
      }))
      .filter((item) => item.team_id > 0);

    if (payload.length === 0) {
      addToast("배정할 팀이 선택된 부서가 없습니다.", "error");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/assets/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ by_department: payload }),
      });
      const data = await res.json();
      if (res.ok) {
        addToast(
          `부서별 일괄 배정 완료: 총 ${data.reassigned}건의 자산이 배정되었습니다.`,
          "success",
        );
        router.refresh();
      } else {
        addToast(data.error || "부서별 일괄 배정에 실패했습니다.", "error");
      }
    } catch {
      addToast("서버 연결에 실패했습니다.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSingleDeptReassign(dept: string) {
    const tId = Number(getSelectedTeam(dept));
    if (!tId || tId <= 0) {
      addToast("배정할 팀을 선택하세요.", "error");
      return;
    }

    const teamName = teams.find((t) => t.id === tId)?.team_name ?? "";
    const deptDisplayName = dept.trim() !== "" ? `'${dept}'` : "(부서 없음)";

    setLoading(true);
    try {
      const res = await fetch("/api/assets/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          by_department: [{ department: dept, team_id: tId }],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        addToast(
          `${deptDisplayName} 부서 자산 ${data.reassigned}건을 '${teamName}' 팀에 배정했습니다.`,
          "success",
        );
        router.refresh();
      } else {
        addToast(data.error || "부서 재배정에 실패했습니다.", "error");
      }
    } catch {
      addToast("서버 연결에 실패했습니다.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function reassign(ids: number[]) {
    if (!teamId) {
      addToast("배정할 팀을 선택하세요.", "error");
      return;
    }
    if (ids.length === 0) {
      addToast("재배정할 자산을 선택하세요.", "error");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/assets/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_ids: ids, team_id: Number(teamId) }),
      });
      const data = await res.json();
      if (res.ok) {
        const teamName = teams.find((t) => t.id === Number(teamId))?.team_name ?? "";
        addToast(`${data.reassigned}건을 '${teamName}' 팀에 배정했습니다.`, "success");
        setSelected(new Set());
        router.refresh();
      } else {
        addToast(data.error || "재배정에 실패했습니다.", "error");
      }
    } catch {
      addToast("서버 연결에 실패했습니다.", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="eyebrow">UNASSIGNED</div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Inbox size={22} /> 미배정 큐
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            소속 팀이 지정되지 않은 자산을 총괄이 팀에 재배정합니다.
          </p>
        </div>
      </div>

      <UsageGuide items={guideItems} />

      {/* 부서별 일괄 배정 패널 */}
      {departmentSummary.length > 0 && (
        <div className="panel p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Building2 size={18} className="text-signal" />
              <h3 className="text-base font-bold">부서별 일괄 배정</h3>
              <span className="text-xs text-slate-500">
                ({departmentSummary.length}개 부서 집계)
              </span>
            </div>
            <button
              onClick={handleBulkDeptReassign}
              disabled={loading}
              className="btn btn-primary inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
            >
              <Sparkles size={14} /> 추천된 부서 일괄 배정
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b">
                  <th className="py-2">부서명</th>
                  <th className="py-2">미배정 건수</th>
                  <th className="py-2">배정 팀 (기본: 자동 추천)</th>
                  <th className="py-2 text-right">실행</th>
                </tr>
              </thead>
              <tbody>
                {departmentSummary.map((d) => {
                  const displayName = d.department.trim() !== "" ? d.department : "(부서 없음)";
                  const suggestedId = d.department.trim() !== "" ? suggestTeam(d.department, teams) : null;
                  const selectedVal = getSelectedTeam(d.department);
                  const isSuggested = suggestedId !== null && Number(selectedVal) === suggestedId;

                  return (
                    <tr key={d.department} className="border-b last:border-0 hover:bg-slate-50/50">
                      <td className="py-2.5 font-medium">{displayName}</td>
                      <td className="py-2.5 num font-semibold text-ink-2">{d.count}건</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <select
                            value={selectedVal}
                            onChange={(e) =>
                              setDeptSelections((prev) => ({
                                ...prev,
                                [d.department]: e.target.value,
                              }))
                            }
                            className="form-input !w-auto text-sm"
                          >
                            <option value="">팀 선택…</option>
                            {teams.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.team_name}
                              </option>
                            ))}
                          </select>
                          {isSuggested && (
                            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1">
                              <Sparkles size={12} /> 자동 추천
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          onClick={() => handleSingleDeptReassign(d.department)}
                          disabled={loading || !selectedVal}
                          className="btn btn-sm btn-secondary text-xs disabled:opacity-40"
                        >
                          배정
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 목록 개별/선택 재배정 */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className="text-sm text-slate-600">선택 {selected.size}건</span>
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="form-input !w-auto"
          >
            <option value="">팀 선택…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.team_name}
              </option>
            ))}
          </select>
          <button
            onClick={() => reassign([...selected])}
            disabled={loading || selected.size === 0}
            className="btn btn-primary inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Check size={15} /> 선택 일괄 재배정
          </button>
        </div>

        {assets.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">미배정 자산이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-2 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="전체 선택"
                  />
                </th>
                <th className="py-2">자산명</th>
                <th className="py-2">부서</th>
                <th className="py-2">유형</th>
                <th className="py-2">IP</th>
                <th className="py-2">관리자</th>
                <th className="py-2">위치/랙</th>
                <th className="py-2 text-right">개별 재배정</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-slate-50/50">
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggle(a.id)}
                      aria-label={`${a.asset_name} 선택`}
                    />
                  </td>
                  <td className="py-2 font-medium">{a.asset_name}</td>
                  <td className="py-2 text-ink-2">{a.department || "(부서 없음)"}</td>
                  <td className="py-2">{typeLabels[a.asset_type] || a.asset_type}</td>
                  <td className="py-2">{a.ip_address || "-"}</td>
                  <td className="py-2">{a.admin_name || "-"}</td>
                  <td className="py-2">
                    {[a.location_name, a.rack_name].filter(Boolean).join(" / ") || "-"}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => reassign([a.id])}
                      disabled={loading || !teamId}
                      className="text-signal hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      재배정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

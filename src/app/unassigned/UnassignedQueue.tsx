"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Check } from "lucide-react";

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
interface Props {
  assets: Asset[];
  teams: Team[];
}

const typeLabels: Record<string, string> = {
  server: "서버",
  network: "네트워크",
  security: "정보보호",
  telecom: "전화설비",
  vm: "가상머신",
  other: "기타",
};

export function UnassignedQueue({ assets, teams }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [teamId, setTeamId] = useState<string>("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

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

  async function reassign(ids: number[]) {
    setMsg("");
    setError(false);
    if (!teamId) {
      setMsg("배정할 팀을 선택하세요.");
      setError(true);
      return;
    }
    if (ids.length === 0) {
      setMsg("재배정할 자산을 선택하세요.");
      setError(true);
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
        setMsg(`${data.reassigned}건을 '${teamName}' 팀에 배정했습니다.`);
        setError(false);
        setSelected(new Set());
        router.refresh();
      } else {
        setMsg(data.error || "재배정에 실패했습니다.");
        setError(true);
      }
    } catch {
      setMsg("서버 연결에 실패했습니다.");
      setError(true);
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
          <p className="text-sm text-slate-500 mt-1">소속 팀이 지정되지 않은 자산을 총괄이 팀에 재배정합니다.</p>
        </div>
      </div>

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
              <option key={t.id} value={t.id}>{t.team_name}</option>
            ))}
          </select>
          <button
            onClick={() => reassign([...selected])}
            disabled={loading || selected.size === 0}
            className="btn btn-primary inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Check size={15} /> 선택 일괄 재배정
          </button>
          {msg && (
            <span className={`text-sm ${error ? "text-fault" : "text-signal"}`}>{msg}</span>
          )}
        </div>

        {assets.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">미배정 자산이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-2 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="전체 선택" />
                </th>
                <th className="py-2">자산명</th>
                <th className="py-2">유형</th>
                <th className="py-2">IP</th>
                <th className="py-2">관리자</th>
                <th className="py-2">위치/랙</th>
                <th className="py-2 text-right">개별 재배정</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggle(a.id)}
                      aria-label={`${a.asset_name} 선택`}
                    />
                  </td>
                  <td className="py-2 font-medium">{a.asset_name}</td>
                  <td className="py-2">{typeLabels[a.asset_type] || a.asset_type}</td>
                  <td className="py-2">{a.ip_address || "-"}</td>
                  <td className="py-2">{a.admin_name || "-"}</td>
                  <td className="py-2">{[a.location_name, a.rack_name].filter(Boolean).join(" / ") || "-"}</td>
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

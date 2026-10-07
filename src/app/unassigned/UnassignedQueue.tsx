"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/components/Toast";
import { UsageGuide } from "@/components/UsageGuide";

interface Asset {
  id: number;
  asset_name: string;
  asset_type: string;
  ip_address: string;
  status: string;
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
  /** 첫 페이지(SSR). 다음 페이지부터는 /api/assets?scope=unassigned 로 받는다. */
  initialRows: Asset[];
  total: number;
  /** 페이지 행 수(서버 상수 pageSize). */
  pageSize: number;
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

const guideItems = [
  "소속 팀이 지정되지 않은 자산(team_id IS NULL)을 관리자(admin)가 특정 팀에 재배정합니다.",
  "목록 선택 재배정: 자산의 체크박스를 선택(페이지를 넘겨도 유지)한 뒤 팀을 지정해 일괄 배정합니다.",
];

export function UnassignedQueue({ initialRows, total: initialTotal, pageSize, teams }: Props) {
  const router = useRouter();
  const { addToast } = useToast();

  // 페이지 상태 — 재배정 후엔 지금 보던 페이지를 다시 받는다(줄어든 만큼 뒤 행이 당겨 올라온다)
  const [assets, setAssets] = useState<Asset[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function loadPage(target: number) {
    setLoading(true);
    try {
      for (let p = Math.max(1, target); ; p--) {
        const qs = new URLSearchParams({ scope: "unassigned", sort: "created_at", dir: "desc", limit: String(pageSize), offset: String((p - 1) * pageSize) });
        const res = await fetch(`/api/assets?${qs}`);
        const data = await res.json();
        if (!res.ok) { addToast(data.error || "목록을 불러오지 못했습니다.", "error"); return; }
        // 마지막 페이지를 다 배정해 비었으면 한 페이지 앞으로
        if (data.rows.length === 0 && p > 1) continue;
        setAssets(data.rows);
        setTotal(data.total);
        setPage(p);
        return;
      }
    } catch {
      addToast("서버 연결에 실패했습니다.", "error");
    } finally {
      setLoading(false);
    }
  }

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [teamId, setTeamId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // 전체 선택 체크박스 = 이 페이지 행 전부(다른 페이지 선택은 유지)
  const allSelected = assets.length > 0 && assets.every((a) => selected.has(a.id));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const a of assets) { if (allSelected) next.delete(a.id); else next.add(a.id); }
      return next;
    });
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
        await loadPage(page);
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
          <p className="text-sm text-ink-3 mt-1">
            소속 팀이 지정되지 않은 자산을 총괄이 팀에 재배정합니다.
          </p>
        </div>
      </div>

      <UsageGuide items={guideItems} />

      {/* 목록 개별/선택 재배정 */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className="text-sm text-slate-600">선택 {selected.size}건</span>
          <select aria-label="선택 자산을 배정할 팀"
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

        {total === 0 ? (
          <p className="text-sm text-ink-3 py-8 text-center">미배정 자산이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-3 border-b">
                <th className="py-2 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="이 페이지 전체 선택"
                  />
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
          </div>
        )}
        {total > 0 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-line text-sm text-ink-2">
            <span className="num">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} / {total}건
            </span>
            <div className="flex items-center gap-1">
              <button
                className="p-1.5 rounded text-ink-3 hover:text-ink disabled:opacity-30 disabled:pointer-events-none transition-colors"
                disabled={loading || page <= 1}
                onClick={() => loadPage(page - 1)}
                aria-label="이전 페이지"
                title="이전 페이지"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="px-2 num">{page} / {totalPages}</span>
              <button
                className="p-1.5 rounded text-ink-3 hover:text-ink disabled:opacity-30 disabled:pointer-events-none transition-colors"
                disabled={loading || page >= totalPages}
                onClick={() => loadPage(page + 1)}
                aria-label="다음 페이지"
                title="다음 페이지"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

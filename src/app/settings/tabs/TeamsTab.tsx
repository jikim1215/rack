"use client";

import { useState } from "react";
import { Users, Plus, Save } from "lucide-react";
import type { Team } from "./types";

interface Props {
  teams: Team[];
  onTeamsChange: React.Dispatch<React.SetStateAction<Team[]>>;
}

export function TeamsTab({ teams, onTeamsChange }: Props) {
  // --- 팀 관리 ---
  const [newTeamName, setNewTeamName] = useState("");
  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  const [editTeamName, setEditTeamName] = useState("");
  const [teamMsg, setTeamMsg] = useState("");
  const [teamError, setTeamError] = useState(false);

  async function refreshTeams() {
    try {
      const res = await fetch("/api/teams");
      if (res.ok) onTeamsChange(await res.json());
    } catch { /* ignore */ }
  }

  async function handleAddTeam(e: React.FormEvent) {
    e.preventDefault();
    setTeamMsg("");
    setTeamError(false);
    if (!newTeamName.trim()) {
      setTeamMsg("팀 이름을 입력하세요.");
      setTeamError(true);
      return;
    }
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_name: newTeamName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        onTeamsChange((prev) => [...prev, data]);
        setNewTeamName("");
        setTeamMsg("팀이 추가되었습니다.");
        setTeamError(false);
        await refreshTeams();
      } else {
        setTeamMsg(data.error || "추가에 실패했습니다.");
        setTeamError(true);
      }
    } catch {
      setTeamMsg("서버 연결에 실패했습니다.");
      setTeamError(true);
    }
  }

  function startEditTeam(team: Team) {
    setEditingTeamId(team.id);
    setEditTeamName(team.team_name);
  }

  async function handleRenameTeam(id: number) {
    setTeamMsg("");
    setTeamError(false);
    if (!editTeamName.trim()) {
      setTeamMsg("팀 이름을 입력하세요.");
      setTeamError(true);
      return;
    }
    try {
      const res = await fetch(`/api/teams/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_name: editTeamName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        onTeamsChange((prev) => prev.map((t) => (t.id === id ? { ...t, team_name: editTeamName.trim() } : t)));
        setEditingTeamId(null);
        setTeamMsg("팀 이름이 변경되었습니다.");
        setTeamError(false);
      } else {
        setTeamMsg(data.error || "변경에 실패했습니다.");
        setTeamError(true);
      }
    } catch {
      setTeamMsg("서버 연결에 실패했습니다.");
      setTeamError(true);
    }
  }

  async function handleDeleteTeam(team: Team) {
    setTeamMsg("");
    setTeamError(false);
    if (!confirm(`'${team.team_name}' 팀을 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch(`/api/teams/${team.id}`, { method: "DELETE" });
      if (res.ok) {
        onTeamsChange((prev) => prev.filter((t) => t.id !== team.id));
        setTeamMsg("팀이 삭제되었습니다.");
        setTeamError(false);
      } else {
        const data = await res.json();
        setTeamMsg(data.error || "삭제에 실패했습니다.");
        setTeamError(true);
      }
    } catch {
      setTeamMsg("서버 연결에 실패했습니다.");
      setTeamError(true);
    }
  }

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <Users size={20} /> 팀 관리
        </h2>
      </div>

      {teamMsg && (
        <p className={`text-sm mb-3 ${teamError ? "text-fault" : "text-signal"}`}>{teamMsg}</p>
      )}

      {/* 팀 추가 폼 */}
      <form onSubmit={handleAddTeam} className="mb-4 p-4 bg-rail rounded-lg flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-ink-2 mb-1">팀 이름</label>
          <input
            type="text"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            className="form-input"
            placeholder="새 팀 이름"
          />
        </div>
        <button
          type="submit"
          className="flex items-center gap-1 btn-ink px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={14} /> 추가
        </button>
      </form>

      {/* 팀 목록 테이블 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="py-2 px-3 font-medium text-ink-2">팀 이름</th>
              <th className="py-2 px-3 font-medium text-ink-2">소속 사용자 수</th>
              <th className="py-2 px-3 font-medium text-ink-2">자산 수</th>
              <th className="py-2 px-3 font-medium text-ink-2">관리</th>
            </tr>
          </thead>
          <tbody>
            {teams.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-4 px-3 text-center text-ink-3">등록된 팀이 없습니다.</td>
              </tr>
            ) : (
              teams.map((t) => (
                <tr key={t.id} className="border-b border-line hover:bg-slate-50">
                  <td className="py-2 px-3 font-medium">
                    {editingTeamId === t.id ? (
                      <input
                        type="text"
                        value={editTeamName}
                        onChange={(e) => setEditTeamName(e.target.value)}
                        className="form-input py-1 text-sm"
                      />
                    ) : (
                      t.team_name
                    )}
                  </td>
                  <td className="py-2 px-3 num text-ink-2">{t.user_count}</td>
                  <td className="py-2 px-3 num text-ink-2">{t.asset_count}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1">
                      {editingTeamId === t.id ? (
                        <>
                          <button
                            onClick={() => handleRenameTeam(t.id)}
                            className="p-1 text-ink-2 hover:text-ink hover:bg-slate-100 rounded"
                            title="저장"
                          >
                            <Save size={14} />
                          </button>
                          <button
                            onClick={() => setEditingTeamId(null)}
                            className="p-1 text-ink-3 hover:bg-slate-100 rounded text-xs"
                          >
                            취소
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditTeam(t)}
                            className="text-xs text-ink-2 hover:text-ink hover:underline"
                          >
                            이름 변경
                          </button>
                          <button
                            onClick={() => handleDeleteTeam(t)}
                            className="text-xs text-fault hover:underline ml-2"
                          >
                            삭제
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

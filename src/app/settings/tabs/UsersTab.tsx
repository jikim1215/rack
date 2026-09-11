"use client";

import { useState } from "react";
import { Users, Plus, Save, ToggleLeft, ToggleRight, Trash2, KeyRound } from "lucide-react";
import { sha512 } from "@/lib/sha512";
import { roleOptions, type Team, type User } from "./types";

interface Props {
  users: User[];
  onUsersChange: React.Dispatch<React.SetStateAction<User[]>>;
  teams: Team[];
  onTeamsChange: React.Dispatch<React.SetStateAction<Team[]>>;
}

export function UsersTab({ users, onUsersChange, teams, onTeamsChange }: Props) {
  // --- 사용자 관리 ---
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ username: string; display_name: string; role: string; team_id: number | null; password: string; allowed_ips: string }>({ username: "", display_name: "", role: "team", team_id: null, password: "", allowed_ips: "" });
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<{ username: string; password: string; display_name: string; role: string; team_id: number | null; allowed_ips: string }>({ username: "", password: "", display_name: "", role: "team", team_id: null, allowed_ips: "" });
  const [userMsg, setUserMsg] = useState("");
  const [userError, setUserError] = useState(false);

  async function refreshUsers() {
    try {
      const res = await fetch("/api/users");
      if (res.ok) onUsersChange(await res.json());
    } catch { /* ignore */ }
  }

  async function refreshTeams() {
    try {
      const res = await fetch("/api/teams");
      if (res.ok) onTeamsChange(await res.json());
    } catch { /* ignore */ }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setUserMsg("");
    setUserError(false);
    // 비밀번호 정책(원문 기준): 서버는 sha512 해시만 받으므로 길이 검증은 클라이언트에서 수행한다(P3; 전체 정책은 P10).
    if (addForm.password.length < 8) {
      setUserMsg("비밀번호는 8자 이상이어야 합니다.");
      setUserError(true);
      return;
    }
    if (addForm.role === "team" && addForm.team_id == null) {
      setUserMsg("팀 역할은 소속 팀을 선택해야 합니다.");
      setUserError(true);
      return;
    }
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...addForm,
          password: await sha512(addForm.password),
          team_id: addForm.role === "team" ? addForm.team_id : null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setUserMsg("사용자가 추가되었습니다.");
        setUserError(false);
        setAddForm({ username: "", password: "", display_name: "", role: "team", team_id: null, allowed_ips: "" });
        setShowAdd(false);
        await refreshUsers();
        await refreshTeams();
      } else {
        setUserMsg(data.error || "추가에 실패했습니다.");
        setUserError(true);
      }
    } catch {
      setUserMsg("서버 연결에 실패했습니다.");
      setUserError(true);
    }
  }

  async function handleEditUser(id: number) {
    setUserMsg("");
    setUserError(false);
    if (!editForm.username.trim()) {
      setUserMsg("아이디를 입력하세요.");
      setUserError(true);
      return;
    }
    if (editForm.role === "team" && editForm.team_id == null) {
      setUserMsg("팀 역할은 소속 팀을 선택해야 합니다.");
      setUserError(true);
      return;
    }
    if (editForm.password && editForm.password.length < 8) {
      setUserMsg("비밀번호는 8자 이상이어야 합니다.");
      setUserError(true);
      return;
    }
    try {
      const { password: editPasswordValue, ...editRest } = editForm;
      const body: Record<string, unknown> = {
        ...editRest,
        team_id: editForm.role === "team" ? editForm.team_id : null,
      };
      if (editPasswordValue) {
        body.password = await sha512(editPasswordValue);
      }
      const res = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditingId(null);
        setUserMsg(editPasswordValue ? "사용자 정보와 비밀번호가 수정되었습니다." : "사용자 정보가 수정되었습니다.");
        setUserError(false);
        await refreshUsers();
        await refreshTeams();
      } else {
        const data = await res.json();
        setUserMsg(data.error || "수정에 실패했습니다.");
        setUserError(true);
      }
    } catch {
      setUserMsg("서버 연결에 실패했습니다.");
      setUserError(true);
    }
  }

  async function handleToggleActive(user: User) {
    setUserMsg("");
    setUserError(false);
    try {
      // 비활성화도 PUT(is_active=0)로 처리한다. DELETE는 계정 영구 삭제 전용.
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: user.username,
          display_name: user.display_name,
          role: user.role,
          is_active: user.is_active ? 0 : 1,
          team_id: user.role === "team" ? user.team_id : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setUserMsg(data.error || "상태 변경에 실패했습니다.");
        setUserError(true);
      }
      await refreshUsers();
    } catch {
      setUserMsg("서버 연결에 실패했습니다.");
      setUserError(true);
    }
  }

  async function handleDeleteUser(user: User) {
    setUserMsg("");
    setUserError(false);
    if (!confirm(`'${user.username}' 계정을 완전히 삭제하시겠습니까?\n\n계정이 영구 삭제되어 되돌릴 수 없습니다(접속·감사 기록의 표기는 보존).`)) return;
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      if (res.ok) {
        setUserMsg("계정이 삭제되었습니다.");
        setUserError(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setUserMsg(data.error || "삭제에 실패했습니다.");
        setUserError(true);
      }
      await refreshUsers();
    } catch {
      setUserMsg("서버 연결에 실패했습니다.");
      setUserError(true);
    }
  }

  async function handleResetPassword(user: User) {
    setUserMsg("");
    setUserError(false);
    if (!confirm(`'${user.username}' 계정의 비밀번호를 초기화하시겠습니까?\n\n비밀번호가 이메일 주소(${user.username})로 초기화되고, 해당 사용자는 다음 로그인 시 새 비밀번호를 반드시 설정해야 합니다.`)) return;
    try {
      const res = await fetch(`/api/users/${user.id}/reset-password`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUserMsg(`'${data.username ?? user.username}' 계정 비밀번호를 이메일 주소로 초기화했습니다. 사용자는 이메일로 로그인한 뒤 새 비밀번호를 설정해야 합니다.` + (data.emailed ? " 초기화 통지 메일을 발송했습니다." : " (메일 릴레이 미설정 — 사용자에게 직접 안내하세요.)"));
        setUserError(false);
      } else {
        setUserMsg(data.error || "초기화에 실패했습니다.");
        setUserError(true);
      }
      await refreshUsers();
    } catch {
      setUserMsg("서버 연결에 실패했습니다.");
      setUserError(true);
    }
  }

  function startEdit(user: User) {
    setEditingId(user.id);
    setEditForm({ username: user.username, display_name: user.display_name, role: user.role, team_id: user.team_id, password: "", allowed_ips: user.allowed_ips ?? "" });
  }

  function teamNameOf(teamId: number | null): string {
    if (teamId == null) return "미배정";
    return teams.find((t) => t.id === teamId)?.team_name || "미배정";
  }

  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <Users size={20} /> 사용자 관리
        </h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 btn-ink px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={14} /> 사용자 추가
        </button>
      </div>

      {userMsg && (
        <p className={`text-sm mb-3 ${userError ? "text-fault" : "text-signal"}`}>{userMsg}</p>
      )}

      {/* 사용자 추가 폼 */}
      {showAdd && (
        <form onSubmit={handleAddUser} className="mb-4 p-4 bg-rail rounded-lg space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">이메일</label>
              <input
                type="email"
                value={addForm.username}
                onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                className="form-input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">비밀번호</label>
              <input
                type="password"
                value={addForm.password}
                onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                className="form-input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">이름</label>
              <input
                type="text"
                value={addForm.display_name}
                onChange={(e) => setAddForm({ ...addForm, display_name: e.target.value })}
                className="form-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">역할</label>
              <select
                value={addForm.role}
                onChange={(e) => setAddForm({ ...addForm, role: e.target.value })}
                className="form-input"
              >
                {roleOptions.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            {addForm.role === "team" && (
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1">팀</label>
                <select
                  value={addForm.team_id ?? ""}
                  onChange={(e) => setAddForm({ ...addForm, team_id: e.target.value ? Number(e.target.value) : null })}
                  className="form-input"
                >
                  <option value="">(미배정)</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.team_name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-ink-2 mb-1">허용 IP (비우면 제한 없음)</label>
              <input
                type="text"
                value={addForm.allowed_ips}
                onChange={(e) => setAddForm({ ...addForm, allowed_ips: e.target.value })}
                className="form-input"
                placeholder="예: 10.20.30.0/24, 10.20.31.5"
              />
              <p className="text-xs text-ink-3 mt-1">콤마로 여러 개. IP 또는 CIDR(예: 10.0.0.0/8). 이 사용자는 지정한 대역에서만 로그인 가능합니다.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="btn-ink px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              추가
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="bg-slate-100 text-ink px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
            >
              취소
            </button>
          </div>
        </form>
      )}

      {/* 사용자 목록 테이블 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="py-2 px-3 font-medium text-ink-2">ID</th>
              <th className="py-2 px-3 font-medium text-ink-2">이메일</th>
              <th className="py-2 px-3 font-medium text-ink-2">이름</th>
              <th className="py-2 px-3 font-medium text-ink-2">역할</th>
              <th className="py-2 px-3 font-medium text-ink-2">팀</th>
              <th className="py-2 px-3 font-medium text-ink-2">상태</th>
              <th className="py-2 px-3 font-medium text-ink-2">관리</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-line hover:bg-slate-50">
                <td className="py-2 px-3 text-ink-3 num">{u.id}</td>
                <td className="py-2 px-3 font-medium">
                  {editingId === u.id ? (
                    <input
                      type="email"
                      value={editForm.username}
                      onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                      className="form-input py-1 text-sm"
                    />
                  ) : (
                    u.username
                  )}
                </td>
                <td className="py-2 px-3">
                  {editingId === u.id ? (
                    <div className="flex flex-col gap-1">
                      <input
                        type="text"
                        value={editForm.display_name}
                        onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                        className="form-input py-1 text-sm"
                      />
                      <label className="block text-xs font-medium text-ink-3 mt-1">새 비밀번호 (변경 시에만 입력)</label>
                      <input
                        type="password"
                        value={editForm.password}
                        onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                        placeholder="비워두면 변경 안 함"
                        className="form-input py-1 text-sm"
                      />
                      <label className="block text-xs font-medium text-ink-3 mt-1">허용 IP (비우면 제한 없음)</label>
                      <input
                        type="text"
                        value={editForm.allowed_ips}
                        onChange={(e) => setEditForm({ ...editForm, allowed_ips: e.target.value })}
                        placeholder="예: 10.20.30.0/24, 10.20.31.5"
                        className="form-input py-1 text-sm"
                      />
                    </div>
                  ) : (
                    u.display_name || "-"
                  )}
                </td>
                <td className="py-2 px-3">
                  {editingId === u.id ? (
                    <select
                      value={editForm.role}
                      onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                      className="form-input py-1 text-sm"
                    >
                      {roleOptions.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  ) : (
                    roleOptions.find((r) => r.value === u.role)?.label || u.role
                  )}
                </td>
                <td className="py-2 px-3">
                  {editingId === u.id ? (
                    editForm.role === "team" ? (
                      <select
                        value={editForm.team_id ?? ""}
                        onChange={(e) => setEditForm({ ...editForm, team_id: e.target.value ? Number(e.target.value) : null })}
                        className="form-input py-1 text-sm"
                      >
                        <option value="">(미배정)</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>{t.team_name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-ink-3">미배정</span>
                    )
                  ) : (
                    u.role === "team" ? teamNameOf(u.team_id) : "미배정"
                  )}
                </td>
                <td className="py-2 px-3">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${
                      u.is_active
                        ? "bg-signal/10 text-signal"
                        : "bg-fault/10 text-fault"
                    }`}
                  >
                    <span className={`led ${u.is_active ? "led-up" : "led-fault"}`} />
                    {u.is_active ? "활성" : "비활성"}
                  </span>
                  {u.must_change_password ? (
                    <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800" title="임시 비밀번호 상태 — 다음 로그인 시 변경 필요">임시비번</span>
                  ) : null}
                </td>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-1">
                    {editingId === u.id ? (
                      <>
                        <button
                          onClick={() => handleEditUser(u.id)}
                          className="p-1 text-ink-2 hover:text-ink hover:bg-slate-100 rounded"
                          title="저장"
                        >
                          <Save size={14} />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 text-ink-3 hover:bg-slate-100 rounded text-xs"
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(u)}
                          className="text-xs text-ink-2 hover:text-ink hover:underline"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => handleToggleActive(u)}
                          className={`p-1 rounded ${
                            u.is_active
                              ? "text-warn hover:bg-amber-50"
                              : "text-signal hover:bg-green-50"
                          }`}
                          title={u.is_active ? "비활성화" : "활성화"}
                        >
                          {u.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        </button>
                        <button
                          onClick={() => handleResetPassword(u)}
                          className="p-1 rounded text-ink-2 hover:text-ink hover:bg-slate-100"
                          title="비밀번호 초기화"
                        >
                          <KeyRound size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u)}
                          className="p-1 rounded text-fault hover:bg-red-50"
                          title="계정 삭제"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

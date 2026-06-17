"use client";

import { useState } from "react";
import { Key, Users, Plus, Save, ToggleLeft, ToggleRight } from "lucide-react";

async function sha512(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hash = await crypto.subtle.digest("SHA-512", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface User {
  id: number;
  username: string;
  display_name: string;
  role: string;
  is_active: number;
  created_at: string;
}

interface Props {
  currentUser: { userId: number; username: string; displayName: string; role: string } | null;
  users: User[];
}

const roleOptions = [
  { value: "admin", label: "관리자" },
  { value: "user", label: "사용자" },
  { value: "viewer", label: "열람자" },
];

export function SettingsView({ currentUser, users: initialUsers }: Props) {
  // --- 비밀번호 변경 ---
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwError, setPwError] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  // --- 사용자 관리 ---
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ display_name: "", role: "user" });
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ username: "", password: "", display_name: "", role: "user" });
  const [userMsg, setUserMsg] = useState("");
  const [userError, setUserError] = useState(false);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg("");
    setPwError(false);

    if (newPw !== confirmPw) {
      setPwMsg("새 비밀번호가 일치하지 않습니다.");
      setPwError(true);
      return;
    }
    if (newPw.length < 4) {
      setPwMsg("비밀번호는 4자 이상이어야 합니다.");
      setPwError(true);
      return;
    }

    setPwLoading(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: await sha512(currentPw),
          newPassword: await sha512(newPw),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPwMsg("비밀번호가 변경되었습니다.");
        setPwError(false);
        setCurrentPw("");
        setNewPw("");
        setConfirmPw("");
      } else {
        setPwMsg(data.error || "변경에 실패했습니다.");
        setPwError(true);
      }
    } catch {
      setPwMsg("서버 연결에 실패했습니다.");
      setPwError(true);
    } finally {
      setPwLoading(false);
    }
  }

  async function refreshUsers() {
    try {
      const res = await fetch("/api/users");
      if (res.ok) setUsers(await res.json());
    } catch { /* ignore */ }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setUserMsg("");
    setUserError(false);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...addForm,
          password: await sha512(addForm.password),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setUserMsg("사용자가 추가되었습니다.");
        setUserError(false);
        setAddForm({ username: "", password: "", display_name: "", role: "user" });
        setShowAdd(false);
        await refreshUsers();
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
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        setEditingId(null);
        await refreshUsers();
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
    try {
      if (user.is_active) {
        await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      } else {
        await fetch(`/api/users/${user.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ display_name: user.display_name, role: user.role, is_active: 1 }),
        });
      }
      await refreshUsers();
    } catch {
      setUserMsg("서버 연결에 실패했습니다.");
      setUserError(true);
    }
  }

  function startEdit(user: User) {
    setEditingId(user.id);
    setEditForm({ display_name: user.display_name, role: user.role });
  }

  if (!currentUser) return null;

  const isAdmin = currentUser.role === "admin";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-slate-800">설정</h1>

      {/* 비밀번호 변경 */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2 mb-4">
          <Key size={20} /> 비밀번호 변경
        </h2>
        <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">현재 비밀번호</label>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="form-input"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">새 비밀번호</label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="form-input"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">새 비밀번호 확인</label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="form-input"
              required
            />
          </div>
          {pwMsg && (
            <p className={`text-sm ${pwError ? "text-red-600" : "text-green-600"}`}>{pwMsg}</p>
          )}
          <button
            type="submit"
            disabled={pwLoading}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {pwLoading ? "변경 중..." : "비밀번호 변경"}
          </button>
        </form>
      </section>

      {/* 사용자 관리 (admin) */}
      {isAdmin && (
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <Users size={20} /> 사용자 관리
            </h2>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus size={14} /> 사용자 추가
            </button>
          </div>

          {userMsg && (
            <p className={`text-sm mb-3 ${userError ? "text-red-600" : "text-green-600"}`}>{userMsg}</p>
          )}

          {/* 사용자 추가 폼 */}
          {showAdd && (
            <form onSubmit={handleAddUser} className="mb-4 p-4 bg-slate-50 rounded-lg space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">아이디</label>
                  <input
                    type="text"
                    value={addForm.username}
                    onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                    className="form-input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">비밀번호</label>
                  <input
                    type="password"
                    value={addForm.password}
                    onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                    className="form-input"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">이름</label>
                  <input
                    type="text"
                    value={addForm.display_name}
                    onChange={(e) => setAddForm({ ...addForm, display_name: e.target.value })}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">역할</label>
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
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  추가
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-300 transition-colors"
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
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-2 px-3 font-medium text-slate-600">ID</th>
                  <th className="py-2 px-3 font-medium text-slate-600">아이디</th>
                  <th className="py-2 px-3 font-medium text-slate-600">이름</th>
                  <th className="py-2 px-3 font-medium text-slate-600">역할</th>
                  <th className="py-2 px-3 font-medium text-slate-600">상태</th>
                  <th className="py-2 px-3 font-medium text-slate-600">관리</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 text-slate-500">{u.id}</td>
                    <td className="py-2 px-3 font-medium">{u.username}</td>
                    <td className="py-2 px-3">
                      {editingId === u.id ? (
                        <input
                          type="text"
                          value={editForm.display_name}
                          onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                          className="form-input py-1 text-sm"
                        />
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
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          u.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {u.is_active ? "활성" : "비활성"}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1">
                        {editingId === u.id ? (
                          <>
                            <button
                              onClick={() => handleEditUser(u.id)}
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                              title="저장"
                            >
                              <Save size={14} />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-1 text-slate-400 hover:bg-slate-100 rounded text-xs"
                            >
                              취소
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(u)}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              수정
                            </button>
                            <button
                              onClick={() => handleToggleActive(u)}
                              className={`p-1 rounded ${
                                u.is_active
                                  ? "text-orange-500 hover:bg-orange-50"
                                  : "text-green-600 hover:bg-green-50"
                              }`}
                              title={u.is_active ? "비활성화" : "활성화"}
                            >
                              {u.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
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
      )}
    </div>
  );
}

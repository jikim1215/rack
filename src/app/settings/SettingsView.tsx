"use client";

import { useState, useEffect } from "react";
import { Key, Users, Plus, Save, ToggleLeft, ToggleRight, Shield } from "lucide-react";


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
  const [activeTab, setActiveTab] = useState<"password" | "users" | "permissions">("password");

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

  // --- 메뉴 권한 관리 ---
  const [selectedRole, setSelectedRole] = useState("user");
  const [permissions, setPermissions] = useState<Record<string, { can_access: number; can_write: number; can_approve: number }>>({});
  const [permMsg, setPermMsg] = useState("");
  const [permError, setPermError] = useState(false);
  const [permLoading, setPermLoading] = useState(false);

  const menuLabels: Record<string, string> = {
    dashboard: '대시보드', assets: '자산관리', racks: '랙 실장도', portmap: '포트맵',
    topology: '토폴로지', ipam: 'IP관리', distribution: '배선관리',
    movements: '반입/반출', maintenance: '유지보수', contracts: '계약관리',
    locations: '위치관리', settings: '설정'
  };
  const menuKeys = Object.keys(menuLabels);
  const fixedAccessMenus = ['dashboard', 'settings'];
  const writableMenus = ['assets', 'ipam', 'distribution', 'movements', 'maintenance', 'contracts', 'locations'];
  const approvableMenus = ['movements'];

  useEffect(() => {
    if (selectedRole && activeTab === "permissions") {
      fetch(`/api/permissions?role=${selectedRole}`)
        .then(r => r.json())
        .then((data: Array<{ menu_key: string; can_access: number; can_write: number; can_approve: number }>) => {
          const map: Record<string, { can_access: number; can_write: number; can_approve: number }> = {};
          for (const row of data) {
            map[row.menu_key] = { can_access: row.can_access, can_write: row.can_write, can_approve: row.can_approve };
          }
          setPermissions(map);
        })
        .catch(() => setPermissions({}));
    }
  }, [selectedRole, activeTab]);

  function togglePermission(menuKey: string, field: "can_access" | "can_write" | "can_approve") {
    setPermissions(prev => {
      const current = prev[menuKey] || { can_access: 0, can_write: 0, can_approve: 0 };
      const newVal = current[field] ? 0 : 1;
      const updated = { ...current, [field]: newVal };
      // 접근 해제 시 쓰기/승인도 해제
      if (field === "can_access" && newVal === 0) {
        updated.can_write = 0;
        updated.can_approve = 0;
      }
      return { ...prev, [menuKey]: updated };
    });
  }

  async function handleSavePermissions() {
    setPermMsg("");
    setPermError(false);
    setPermLoading(true);
    try {
      const permList = menuKeys.map(key => ({
        menu_key: key,
        ...(permissions[key] || { can_access: 0, can_write: 0, can_approve: 0 }),
      }));
      const res = await fetch("/api/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: selectedRole, permissions: permList }),
      });
      if (res.ok) {
        setPermMsg("권한이 저장되었습니다.");
        setPermError(false);
      } else {
        const data = await res.json();
        setPermMsg(data.error || "저장에 실패했습니다.");
        setPermError(true);
      }
    } catch {
      setPermMsg("서버 연결에 실패했습니다.");
      setPermError(true);
    } finally {
      setPermLoading(false);
    }
  }


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
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">설정</h1>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setActiveTab("password")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "password"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <span className="flex items-center gap-1.5"><Key size={16} /> 비밀번호 변경</span>
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab("users")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "users"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <span className="flex items-center gap-1.5"><Users size={16} /> 사용자 관리</span>
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setActiveTab("permissions")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "permissions"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <span className="flex items-center gap-1.5"><Shield size={16} /> 메뉴 권한</span>
          </button>
        )}
      </div>


      {/* 비밀번호 변경 */}
      {activeTab === "password" && (
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
      )}


      {/* 사용자 관리 (admin) */}
      {activeTab === "users" && isAdmin && (
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

      {/* 메뉴 권한 관리 (admin) */}
      {activeTab === "permissions" && isAdmin && (
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2 mb-4">
            <Shield size={20} /> 메뉴 권한 관리
          </h2>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">역할 선택</label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="form-input w-48"
            >
              <option value="admin">관리자</option>
              <option value="user">사용자</option>
              <option value="viewer">열람자</option>
            </select>
          </div>

          {selectedRole === "admin" ? (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 mb-4">
              관리자는 모든 권한이 부여됩니다.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left">
                      <th className="py-2 px-3 font-medium text-slate-600">메뉴</th>
                      <th className="py-2 px-3 font-medium text-slate-600 text-center">접근</th>
                      <th className="py-2 px-3 font-medium text-slate-600 text-center">쓰기</th>
                      <th className="py-2 px-3 font-medium text-slate-600 text-center">승인</th>
                    </tr>
                  </thead>
                  <tbody>
                    {menuKeys.map((key) => {
                      const perm = permissions[key] || { can_access: 0, can_write: 0, can_approve: 0 };
                      const isFixed = fixedAccessMenus.includes(key);
                      const hasWrite = writableMenus.includes(key);
                      const hasApprove = approvableMenus.includes(key);
                      return (
                        <tr key={key} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="py-2 px-3 font-medium text-slate-700">{menuLabels[key]}</td>
                          <td className="py-2 px-3 text-center">
                            {isFixed ? (
                              <input type="checkbox" checked disabled className="accent-blue-600" />
                            ) : (
                              <input
                                type="checkbox"
                                checked={!!perm.can_access}
                                onChange={() => togglePermission(key, "can_access")}
                                className="accent-blue-600 cursor-pointer"
                              />
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {hasWrite ? (
                              <input
                                type="checkbox"
                                checked={!!perm.can_write}
                                onChange={() => togglePermission(key, "can_write")}
                                className="accent-blue-600 cursor-pointer"
                              />
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {hasApprove ? (
                              <input
                                type="checkbox"
                                checked={!!perm.can_approve}
                                onChange={() => togglePermission(key, "can_approve")}
                                className="accent-blue-600 cursor-pointer"
                              />
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {permMsg && (
                <p className={`text-sm mb-3 ${permError ? "text-red-600" : "text-green-600"}`}>{permMsg}</p>
              )}

              <button
                onClick={handleSavePermissions}
                disabled={permLoading}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                <Save size={14} /> {permLoading ? "저장 중..." : "권한 저장"}
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}

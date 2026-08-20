"use client";

import { useState, useEffect } from "react";
import { Key, Users, Plus, Save, ToggleLeft, ToggleRight, Shield, Trash2, KeyRound, Mail } from "lucide-react";
import { sha512 } from "@/lib/sha512";



interface User {
  id: number;
  username: string;
  display_name: string;
  role: string;
  is_active: number;
  must_change_password?: number;
  created_at: string;
  team_id: number | null;
  allowed_ips?: string;
}

interface Team {
  id: number;
  team_name: string;
  created_at: string;
  user_count: number;
  asset_count: number;
}

interface Props {
  currentUser: { userId: number; username: string; displayName: string; role: string } | null;
  users: User[];
  teams: Team[];
}

const roleOptions = [
  { value: "admin", label: "총괄" },
  { value: "team", label: "팀" },
  { value: "viewer", label: "전체열람" },
];

export function SettingsView({ currentUser, users: initialUsers, teams: initialTeams }: Props) {
  const [activeTab, setActiveTab] = useState<"password" | "users" | "teams" | "permissions" | "mail">("password");

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
  const [editForm, setEditForm] = useState<{ username: string; display_name: string; role: string; team_id: number | null; password: string; allowed_ips: string }>({ username: "", display_name: "", role: "team", team_id: null, password: "", allowed_ips: "" });
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<{ username: string; password: string; display_name: string; role: string; team_id: number | null; allowed_ips: string }>({ username: "", password: "", display_name: "", role: "team", team_id: null, allowed_ips: "" });
  const [userMsg, setUserMsg] = useState("");
  const [userError, setUserError] = useState(false);

  // --- 팀 관리 ---
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [newTeamName, setNewTeamName] = useState("");
  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  const [editTeamName, setEditTeamName] = useState("");
  const [teamMsg, setTeamMsg] = useState("");
  const [teamError, setTeamError] = useState(false);

  // --- 메뉴 권한 관리 ---
  const [selectedRole, setSelectedRole] = useState("team");
  const [permissions, setPermissions] = useState<Record<string, { can_access: number; can_write: number; can_approve: number }>>({});
  const [permMsg, setPermMsg] = useState("");
  const [permError, setPermError] = useState(false);
  const [permLoading, setPermLoading] = useState(false);

  const menuLabels: Record<string, string> = {
    dashboard: '대시보드', assets: '자산관리', subassets: '부속자산', racks: '랙 실장도',
    ipam: 'IP관리', distribution: '배선관리', movements: '반입/반출', maintenance: '유지보수',
    inspection: '자산실사', contracts: '계약관리', reports: '통계 리포트',
    locations: '위치관리', settings: '설정'
  };
  const menuKeys = Object.keys(menuLabels);
  const fixedAccessMenus = ['dashboard', 'settings'];
  const writableMenus = ['assets', 'subassets', 'ipam', 'distribution', 'movements', 'maintenance', 'inspection', 'contracts', 'locations'];
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

  // --- 메일 릴레이 설정 (admin) ---
  const [mail, setMail] = useState<{ host: string; port: number; security: string; from_address: string; from_name: string; base_url: string; enabled: boolean }>({ host: "", port: 25, security: "NONE", from_address: "", from_name: "", base_url: "", enabled: false });
  const [mailMsg, setMailMsg] = useState("");
  const [mailError, setMailError] = useState(false);
  const [mailLoading, setMailLoading] = useState(false);
  const [mailChannelOff, setMailChannelOff] = useState(false);
  const [testTo, setTestTo] = useState("");

  useEffect(() => {
    if (activeTab !== "mail") return;
    fetch("/api/admin/mail-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setMail({ host: d.host ?? "", port: d.port ?? 25, security: d.security ?? "NONE", from_address: d.from_address ?? "", from_name: d.from_name ?? "", base_url: d.base_url ?? "", enabled: !!d.enabled });
        setMailChannelOff(!!d.channel_forced_off);
      })
      .catch(() => {});
  }, [activeTab]);

  async function handleSaveMail(e: React.FormEvent) {
    e.preventDefault();
    setMailMsg(""); setMailError(false); setMailLoading(true);
    try {
      const res = await fetch("/api/admin/mail-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mail) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setMailMsg("메일 설정을 저장했습니다."); setMailError(false); }
      else { setMailMsg(data.error || "저장에 실패했습니다."); setMailError(true); }
    } catch { setMailMsg("서버 연결에 실패했습니다."); setMailError(true); }
    finally { setMailLoading(false); }
  }

  async function handleTestMail() {
    setMailMsg(""); setMailError(false); setMailLoading(true);
    try {
      const res = await fetch("/api/admin/mail-config/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: testTo.trim() || undefined }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setMailMsg(`테스트 메일을 ${data.to} 로 발송했습니다.`); setMailError(false); }
      else { setMailMsg(data.error || "테스트 발송에 실패했습니다."); setMailError(true); }
    } catch { setMailMsg("서버 연결에 실패했습니다."); setMailError(true); }
    finally { setMailLoading(false); }
  }
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


  async function refreshTeams() {
    try {
      const res = await fetch("/api/teams");
      if (res.ok) setTeams(await res.json());
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
        setTeams((prev) => [...prev, data]);
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
        setTeams((prev) => prev.map((t) => (t.id === id ? { ...t, team_name: editTeamName.trim() } : t)));
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
        setTeams((prev) => prev.filter((t) => t.id !== team.id));
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

  function teamNameOf(teamId: number | null): string {
    if (teamId == null) return "미배정";
    return teams.find((t) => t.id === teamId)?.team_name || "미배정";
  }
  if (!currentUser) return null;

  const isAdmin = currentUser.role === "admin";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h2 className="text-2xl font-bold tracking-tight">설정</h2>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-line">
        <button
          onClick={() => setActiveTab("password")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "password"
              ? "border-signal text-ink"
              : "border-transparent text-ink-2 hover:text-ink"
          }`}
        >
          <span className="flex items-center gap-1.5"><Key size={16} /> 비밀번호 변경</span>
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab("users")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "users"
                ? "border-signal text-ink"
                : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            <span className="flex items-center gap-1.5"><Users size={16} /> 사용자 관리</span>
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setActiveTab("teams")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "teams"
                ? "border-signal text-ink"
                : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            <span className="flex items-center gap-1.5"><Users size={16} /> 팀 관리</span>
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setActiveTab("permissions")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "permissions"
                ? "border-signal text-ink"
                : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            <span className="flex items-center gap-1.5"><Shield size={16} /> 메뉴 권한</span>
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setActiveTab("mail")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "mail"
                ? "border-signal text-ink"
                : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            <span className="flex items-center gap-1.5"><Mail size={16} /> 메일 설정</span>
          </button>
        )}
      </div>


      {/* 비밀번호 변경 */}
      {activeTab === "password" && (
      <section className="panel p-6">

        <h2 className="text-lg font-semibold text-ink flex items-center gap-2 mb-4">
          <Key size={20} /> 비밀번호 변경
        </h2>
        <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1">현재 비밀번호</label>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="form-input"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1">새 비밀번호</label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="form-input"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-1">새 비밀번호 확인</label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="form-input"
              required
            />
          </div>
          {pwMsg && (
            <p className={`text-sm ${pwError ? "text-fault" : "text-signal"}`}>{pwMsg}</p>
          )}
          <button
            type="submit"
            disabled={pwLoading}
            className="btn-ink px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {pwLoading ? "변경 중..." : "비밀번호 변경"}
          </button>
        </form>
      </section>
      )}


      {/* 사용자 관리 (admin) */}
      {activeTab === "users" && isAdmin && (
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
      )}

      {/* 팀 관리 (admin) */}
      {activeTab === "teams" && isAdmin && (
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
      )}

      {/* 메뉴 권한 관리 (admin) */}
      {activeTab === "permissions" && isAdmin && (
        <section className="panel p-6">
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2 mb-4">
            <Shield size={20} /> 메뉴 권한 관리
          </h2>
          {/* 권한 이중구조 설명 (외부 검토 R6-6 합의): 역할 vs 메뉴 매트릭스 우선순위 */}
          <div className="mb-4 text-xs text-ink-3 bg-slate-50 border border-line rounded-lg px-3 py-2 space-y-0.5">
            <p>· <strong className="text-ink-2">역할이 기본 권한</strong>입니다: 총괄=전체, 팀=자기 팀 자산 읽기/쓰기, 전체열람=조회 전용.</p>
            <p>· 이 매트릭스는 역할 안에서 <strong className="text-ink-2">메뉴별로 더 좁히는 세부 제한</strong>입니다 — 여기서 체크해도 역할이 허용하지 않는 동작(예: 전체열람의 쓰기)은 열리지 않습니다.</p>
            <p>· 변경은 해당 역할 사용자의 <strong className="text-ink-2">다음 요청부터 즉시</strong> 반영됩니다. 승인 권한은 반출입 승인 단계에 적용됩니다.</p>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-ink-2 mb-1">역할 선택</label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="form-input w-48"
            >
              <option value="admin">총괄</option>
              <option value="team">팀</option>
              <option value="viewer">전체열람</option>
            </select>
          </div>

          {selectedRole === "admin" ? (
            <div className="p-4 bg-slate-100 border border-line rounded-lg text-sm text-ink mb-4">
              관리자는 모든 권한이 부여됩니다.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <th className="py-2 px-3 font-medium text-ink-2">메뉴</th>
                      <th className="py-2 px-3 font-medium text-ink-2 text-center">접근</th>
                      <th className="py-2 px-3 font-medium text-ink-2 text-center">쓰기</th>
                      <th className="py-2 px-3 font-medium text-ink-2 text-center">승인</th>
                    </tr>
                  </thead>
                  <tbody>
                    {menuKeys.map((key) => {
                      const perm = permissions[key] || { can_access: 0, can_write: 0, can_approve: 0 };
                      const isFixed = fixedAccessMenus.includes(key);
                      const hasWrite = writableMenus.includes(key);
                      const hasApprove = approvableMenus.includes(key);
                      return (
                        <tr key={key} className="border-b border-line hover:bg-slate-50">
                          <td className="py-2 px-3 font-medium text-ink">{menuLabels[key]}</td>
                          <td className="py-2 px-3 text-center">
                            {isFixed ? (
                              <input type="checkbox" checked disabled className="accent-signal" />
                            ) : (
                              <input
                                type="checkbox"
                                checked={!!perm.can_access}
                                onChange={() => togglePermission(key, "can_access")}
                                className="accent-signal cursor-pointer"
                              />
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {hasWrite ? (
                              <input
                                type="checkbox"
                                checked={!!perm.can_write}
                                onChange={() => togglePermission(key, "can_write")}
                                className="accent-signal cursor-pointer"
                              />
                            ) : (
                              <span className="text-ink-3">—</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">
                            {hasApprove ? (
                              <input
                                type="checkbox"
                                checked={!!perm.can_approve}
                                onChange={() => togglePermission(key, "can_approve")}
                                className="accent-signal cursor-pointer"
                              />
                            ) : (
                              <span className="text-ink-3">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {permMsg && (
                <p className={`text-sm mb-3 ${permError ? "text-fault" : "text-signal"}`}>{permMsg}</p>
              )}

              <button
                onClick={handleSavePermissions}
                disabled={permLoading}
                className="btn-ink px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                <Save size={14} /> {permLoading ? "저장 중..." : "권한 저장"}
              </button>
            </>
          )}
        </section>
      )}

      {/* 메일 설정 (admin) */}
      {activeTab === "mail" && isAdmin && (
        <section className="panel p-6">
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2 mb-2">
            <Mail size={20} /> 메일 설정
          </h2>
          <p className="text-xs text-ink-3 bg-slate-50 border border-line rounded-lg px-3 py-2 mb-4">
            허용 IP 방식 사내 SMTP 릴레이(계정/비밀번호 없음)입니다. 비밀번호 초기화 통지 등 <b>알림 메일</b> 발송에만 사용되며, 비밀번호 자체는 메일에 포함되지 않습니다.
          </p>
          {mailChannelOff && (
            <p className="text-xs text-warn bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              환경변수 <code>NOTIFICATION_CHANNELS</code> 로 이메일 채널이 강제 비활성화되어 있습니다(발송 안 됨).
            </p>
          )}
          <form onSubmit={handleSaveMail} className="space-y-3 max-w-lg">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-ink-2 mb-1">SMTP 호스트</label>
                <input type="text" value={mail.host} onChange={(e) => setMail({ ...mail, host: e.target.value })} placeholder="relay.example.go.kr" className="form-input" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1">포트</label>
                <input type="number" value={mail.port} onChange={(e) => setMail({ ...mail, port: Number(e.target.value) })} className="form-input" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1">보안</label>
                <select value={mail.security} onChange={(e) => setMail({ ...mail, security: e.target.value })} className="form-input">
                  <option value="NONE">NONE (평문)</option>
                  <option value="STARTTLS">STARTTLS</option>
                  <option value="TLS">TLS</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1">발신 주소</label>
                <input type="email" value={mail.from_address} onChange={(e) => setMail({ ...mail, from_address: e.target.value })} placeholder="noreply@example.go.kr" className="form-input" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1">발신 이름 (선택)</label>
                <input type="text" value={mail.from_name} onChange={(e) => setMail({ ...mail, from_name: e.target.value })} placeholder="자산관리" className="form-input" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-ink-2 mb-1">기준 URL</label>
                <input type="text" value={mail.base_url} onChange={(e) => setMail({ ...mail, base_url: e.target.value })} placeholder="https://itam.example.go.kr" className="form-input" />
                <p className="text-[0.6875rem] text-ink-3 mt-1">메일 본문의 로그인 링크에 사용됩니다.</p>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={mail.enabled} onChange={(e) => setMail({ ...mail, enabled: e.target.checked })} className="accent-signal" />
              이메일 발송 활성화 (호스트·발신 주소·기준 URL 필요)
            </label>
            {mailMsg && (
              <p className={`text-sm ${mailError ? "text-fault" : "text-signal"}`}>{mailMsg}</p>
            )}
            <button type="submit" disabled={mailLoading} className="btn-ink px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1.5">
              <Save size={14} /> {mailLoading ? "저장 중..." : "설정 저장"}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-line max-w-lg">
            <h3 className="text-sm font-medium text-ink mb-2">테스트 발송</h3>
            <div className="flex items-center gap-2">
              <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="비우면 내 이메일로" className="form-input flex-1" />
              <button type="button" onClick={handleTestMail} disabled={mailLoading} className="px-3 py-2 rounded-lg text-sm border border-line hover:bg-slate-50 disabled:opacity-50 shrink-0">
                테스트 메일
              </button>
            </div>
            <p className="text-[0.6875rem] text-ink-3 mt-1">저장된 SMTP 설정으로 연결성만 확인합니다(활성화 토글과 무관).</p>
          </div>
        </section>
      )}
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { Users, Plus, Save, ToggleLeft, ToggleRight, Trash2, KeyRound, ShieldOff, FileSpreadsheet, Download, UserX } from "lucide-react";
import { sha512 } from "@/lib/sha512";
import { validatePasswordPolicy } from "@/lib/password-policy";
import { roleOptions, type Team, type User } from "./types";

interface ImportPreviewRow { row: number; username: string; display_name: string; role: string; team_name: string; allowed_ips: string }
interface ImportErrorRow { row: number; username: string; message: string }
interface InactiveRow { id: number; username: string; display_name: string; last_login_at: string | null; last_activity: string }

/** 비활성화(6개월) 전 미리 알리는 기준 — 약 5개월 */
const IDLE_WARN_DAYS = 150;

/** 'YYYY-MM-DD HH:MM:SS'(서버 localtime) → 오늘까지 경과 일수. 값이 없으면 0. */
function idleDays(ts: string | undefined): number {
  if (!ts) return 0;
  const t = new Date(ts.replace(" ", "T")).getTime();
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : 0;
}

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

  // --- 엑셀 일괄 등록: 검증(dryRun) → 미리보기 → 등록. 같은 파일을 두 번 올린다(서버는 등록 때 다시 검증). ---
  const [showImport, setShowImport] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreviewRow[] | null>(null);
  const [importErrors, setImportErrors] = useState<ImportErrorRow[]>([]);

  function resetImport() {
    setImportFile(null);
    setImportPreview(null);
    setImportErrors([]);
    if (importRef.current) importRef.current.value = "";
  }

  async function postImport(file: File, dryRun: boolean) {
    const fd = new FormData();
    fd.append("file", file);
    if (dryRun) fd.append("dryRun", "1");
    const res = await fetch("/api/users/import", { method: "POST", body: fd });
    return { res, data: await res.json().catch(() => ({})) };
  }

  async function handleImportCheck(file: File) {
    setUserMsg("");
    setUserError(false);
    setImportFile(file);
    setImportPreview(null);
    setImportErrors([]);
    setImportBusy(true);
    try {
      const { res, data } = await postImport(file, true);
      if (res.ok) setImportPreview(data.users ?? []);
      else {
        setImportErrors(data.errors ?? []);
        setUserMsg(data.error || "검증에 실패했습니다.");
        setUserError(true);
      }
    } catch {
      setUserMsg("서버 연결에 실패했습니다.");
      setUserError(true);
    } finally {
      setImportBusy(false);
    }
  }

  async function handleImportCommit() {
    if (!importFile) return;
    setImportBusy(true);
    try {
      const { res, data } = await postImport(importFile, false);
      if (res.ok) {
        setUserMsg(`${data.inserted}명을 등록했습니다. 초기 비밀번호는 각자의 이메일 주소이며, 첫 로그인 때 새 비밀번호를 설정해야 합니다.`);
        setUserError(false);
        resetImport();
        setShowImport(false);
        await refreshUsers();
        await refreshTeams();
      } else {
        setImportPreview(null);
        setImportErrors(data.errors ?? []);
        setUserMsg(data.error || "등록에 실패했습니다.");
        setUserError(true);
      }
    } catch {
      setUserMsg("서버 연결에 실패했습니다.");
      setUserError(true);
    } finally {
      setImportBusy(false);
    }
  }

  // --- 장기 미사용 점검: 매일 자동 처리되지만, 총괄이 대상을 미리 보고 즉시 처리할 수 있다. ---
  const [inactive, setInactive] = useState<{ months: number; cutoff: string; users: InactiveRow[] } | null>(null);
  const [inactiveBusy, setInactiveBusy] = useState(false);

  async function loadInactive() {
    setUserMsg("");
    setUserError(false);
    setInactiveBusy(true);
    try {
      const res = await fetch("/api/users/inactive");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setInactive(data);
      else {
        setUserMsg(data.error || "조회에 실패했습니다.");
        setUserError(true);
      }
    } catch {
      setUserMsg("서버 연결에 실패했습니다.");
      setUserError(true);
    } finally {
      setInactiveBusy(false);
    }
  }

  async function deactivateInactive() {
    if (!inactive || inactive.users.length === 0) return;
    if (!confirm(`장기 미사용 계정 ${inactive.users.length}개를 비활성화하시겠습니까?\n\n계정은 삭제되지 않으며, 필요하면 목록에서 다시 활성화할 수 있습니다.`)) return;
    setInactiveBusy(true);
    try {
      const res = await fetch("/api/users/inactive", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUserMsg(`${data.deactivated.length}개 계정을 비활성화했습니다.`);
        setUserError(false);
        setInactive(null);
        await refreshUsers();
      } else {
        setUserMsg(data.error || "비활성화에 실패했습니다.");
        setUserError(true);
      }
    } catch {
      setUserMsg("서버 연결에 실패했습니다.");
      setUserError(true);
    } finally {
      setInactiveBusy(false);
    }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setUserMsg("");
    setUserError(false);
    // 비밀번호 정책(원문 기준): 서버는 sha512 해시만 받으므로 정책 검증은 평문을 아는 클라이언트가 수행한다(서버와 같은 규칙).
    {
      const policyError = validatePasswordPolicy(addForm.password);
      if (policyError) {
        setUserMsg(policyError);
        setUserError(true);
        return;
      }
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
          password: await sha512(addForm.password), // 정책 검사는 위에서(평문)
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
        const policyError = validatePasswordPolicy(editPasswordValue);
        if (policyError) { setUserMsg(policyError); setUserError(true); return; }
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

  // 2단계 인증 해제 — 인증 기기를 잃고 백업 코드도 없는 사용자의 유일한 탈출구(총괄 전용).
  async function handleResetMfa(user: User) {
    setUserMsg("");
    setUserError(false);
    if (!confirm(`'${user.username}' 계정의 2단계 인증을 해제하시겠습니까?\n\n해제하면 그 계정은 비밀번호만으로 로그인합니다. 사용자에게 재등록을 안내하세요.\n(해제 내역은 감사로그에 남습니다)`)) return;
    try {
      const res = await fetch(`/api/users/${user.id}/mfa`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setUserMsg(`'${user.username}' 2단계 인증을 해제했습니다. 사용자에게 설정 → 2단계 인증에서 재등록하도록 안내하세요.`);
        onUsersChange(users.map((x) => (x.id === user.id ? { ...x, totp_enabled: 0 } : x)));
      } else {
        setUserMsg(data.error || "해제에 실패했습니다.");
        setUserError(true);
      }
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
        <div className="flex items-center gap-2">
          <button onClick={loadInactive} disabled={inactiveBusy} className="btn inline-flex items-center gap-1">
            <UserX size={14} /> 장기 미사용 점검
          </button>
          <button onClick={() => { setShowImport(!showImport); resetImport(); }} className="btn inline-flex items-center gap-1">
            <FileSpreadsheet size={14} /> 엑셀 일괄 등록
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1 btn-ink px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={14} /> 사용자 추가
          </button>
        </div>
      </div>

      {userMsg && (
        <p className={`text-sm mb-3 ${userError ? "text-fault" : "text-signal"}`}>{userMsg}</p>
      )}

      {/* 사용자 추가 폼 */}
      {showAdd && (
        <form onSubmit={handleAddUser} className="mb-4 p-4 bg-surface border border-line rounded-lg space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">이메일</label>
              <input aria-label="이메일"
                type="email"
                value={addForm.username}
                onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                className="form-input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">비밀번호</label>
              <input aria-label="비밀번호"
                type="password"
                value={addForm.password}
                onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                className="form-input"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">이름</label>
              <input aria-label="이름"
                type="text"
                value={addForm.display_name}
                onChange={(e) => setAddForm({ ...addForm, display_name: e.target.value })}
                className="form-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">역할</label>
              <select aria-label="역할"
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
                <select aria-label="팀"
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
              <input aria-label="허용 IP (비우면 제한 없음)"
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

      {/* 장기 미사용 점검 결과 */}
      {inactive && (
        <div className="mb-4 p-4 bg-surface border border-line rounded-lg space-y-3">
          <p className="text-sm text-ink-2">
            마지막 활동(로그인·계정 생성·재활성화 중 가장 늦은 시각)이 <span className="num">{inactive.cutoff}</span> 이전인 활성 계정
            ({inactive.months}개월 미사용) — <b className="num">{inactive.users.length}</b>개.
            매일 03:30 자동으로 비활성화됩니다. 마지막 남은 총괄 계정은 제외됩니다.
          </p>
          {inactive.users.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-2">
                  <th className="py-1 px-2 font-medium">이메일</th>
                  <th className="py-1 px-2 font-medium">이름</th>
                  <th className="py-1 px-2 font-medium">마지막 로그인</th>
                  <th className="py-1 px-2 font-medium">마지막 활동</th>
                </tr>
              </thead>
              <tbody>
                {inactive.users.map((u) => (
                  <tr key={u.id} className="border-b border-line">
                    <td className="py-1 px-2">{u.username}</td>
                    <td className="py-1 px-2">{u.display_name || "-"}</td>
                    <td className="py-1 px-2 num">{u.last_login_at?.slice(0, 16) ?? "없음"}</td>
                    <td className="py-1 px-2 num">{u.last_activity.slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex gap-2">
            {inactive.users.length > 0 && (
              <button onClick={deactivateInactive} disabled={inactiveBusy} className="btn-ink px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {inactive.users.length}개 지금 비활성화
              </button>
            )}
            <button onClick={() => setInactive(null)} className="bg-slate-100 text-ink px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-200">닫기</button>
          </div>
        </div>
      )}

      {/* 엑셀 일괄 등록 */}
      {showImport && (
        <div className="mb-4 p-4 bg-surface border border-line rounded-lg space-y-3">
          <p className="text-sm text-ink-2">
            양식을 내려받아 이메일·이름·역할(팀/전체열람)·팀·허용IP를 적어 올리세요. 초기 비밀번호는 각자의 이메일 주소이고
            첫 로그인 때 변경해야 합니다. 총괄 계정은 일괄 등록할 수 없습니다. 한 행이라도 오류가 있으면 아무도 등록되지 않습니다.
          </p>
          <div className="flex items-center gap-2">
            <a href="/api/users/import" className="btn inline-flex items-center gap-1"><Download size={14} /> 양식 내려받기</a>
            <button onClick={() => importRef.current?.click()} disabled={importBusy} className="btn inline-flex items-center gap-1">
              <FileSpreadsheet size={14} /> {importBusy ? "처리중..." : "파일 선택·검증"}
            </button>
            <input ref={importRef} type="file" accept=".xlsx" className="hidden" aria-label="사용자 일괄 등록 파일"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportCheck(f); }} />
            {importFile && <span className="text-xs text-ink-3">{importFile.name}</span>}
          </div>
          {importErrors.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-2">
                  <th className="py-1 px-2 font-medium w-16">행</th>
                  <th className="py-1 px-2 font-medium">이메일</th>
                  <th className="py-1 px-2 font-medium">오류</th>
                </tr>
              </thead>
              <tbody>
                {importErrors.map((er, i) => (
                  <tr key={i} className="border-b border-line text-fault">
                    <td className="py-1 px-2 num">{er.row}</td>
                    <td className="py-1 px-2">{er.username || "-"}</td>
                    <td className="py-1 px-2">{er.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {importPreview && (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-2">
                    <th className="py-1 px-2 font-medium w-16">행</th>
                    <th className="py-1 px-2 font-medium">이메일</th>
                    <th className="py-1 px-2 font-medium">이름</th>
                    <th className="py-1 px-2 font-medium">역할</th>
                    <th className="py-1 px-2 font-medium">팀</th>
                    <th className="py-1 px-2 font-medium">허용 IP</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.map((u) => (
                    <tr key={u.row} className="border-b border-line">
                      <td className="py-1 px-2 num">{u.row}</td>
                      <td className="py-1 px-2">{u.username}</td>
                      <td className="py-1 px-2">{u.display_name || "-"}</td>
                      <td className="py-1 px-2">{roleOptions.find((r) => r.value === u.role)?.label ?? u.role}</td>
                      <td className="py-1 px-2">{u.team_name || "-"}</td>
                      <td className="py-1 px-2">{u.allowed_ips || "제한 없음"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={handleImportCommit} disabled={importBusy} className="btn-ink px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {importBusy ? "등록중..." : `${importPreview.length}명 등록`}
              </button>
            </>
          )}
        </div>
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
              <th className="py-2 px-3 font-medium text-ink-2">마지막 로그인</th>
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
                    <input aria-label="이메일(로그인 ID)"
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
                      <input aria-label="이름"
                        type="text"
                        value={editForm.display_name}
                        onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                        className="form-input py-1 text-sm"
                      />
                      <label className="block text-xs font-medium text-ink-3 mt-1">새 비밀번호 (변경 시에만 입력)</label>
                      <input aria-label="새 비밀번호 (변경 시에만 입력)"
                        type="password"
                        value={editForm.password}
                        onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                        placeholder="비워두면 변경 안 함"
                        className="form-input py-1 text-sm"
                      />
                      <label className="block text-xs font-medium text-ink-3 mt-1">허용 IP (비우면 제한 없음)</label>
                      <input aria-label="허용 IP (비우면 제한 없음)"
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
                    <select aria-label="역할"
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
                      <select aria-label="팀"
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
                <td className="py-2 px-3 text-ink-2 num whitespace-nowrap">
                  {u.last_login_at ? u.last_login_at.slice(0, 16) : <span className="text-ink-3">없음</span>}
                  {!!u.is_active && idleDays(u.last_activity) >= IDLE_WARN_DAYS && (
                    <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800"
                      title="마지막 활동 후 6개월이 지나면 자동으로 비활성화됩니다">
                      미사용 {idleDays(u.last_activity)}일
                    </span>
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
                        {!!u.totp_enabled && (
                          <button
                            onClick={() => handleResetMfa(u)}
                            className="p-1 rounded text-warn hover:bg-amber-50"
                            title="2단계 인증 해제 (기기 분실 시)"
                          >
                            <ShieldOff size={16} />
                          </button>
                        )}
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

"use client";

import { useState, useEffect } from "react";
import { Shield, Save } from "lucide-react";
import { PERMISSION_MENUS, FIXED_ACCESS_KEYS } from "@/lib/menus";

interface Props {
  active: boolean;
}

export function PermissionsTab({ active }: Props) {
  // --- 메뉴 권한 관리 ---
  const [selectedRole, setSelectedRole] = useState("team");
  const [permissions, setPermissions] = useState<Record<string, { can_access: number; can_write: number; can_approve: number }>>({});
  const [permMsg, setPermMsg] = useState("");
  const [permError, setPermError] = useState(false);
  const [permLoading, setPermLoading] = useState(false);

  // 메뉴 정본: src/lib/menus.ts (라벨·고정접근·쓰기/승인 노출 여부). 총괄 전용 메뉴(로그/감사)는 역할로 고정이라 제외.
  const menuLabels: Record<string, string> = Object.fromEntries(PERMISSION_MENUS.map((m) => [m.key, m.label]));
  const menuKeys = PERMISSION_MENUS.map((m) => m.key);
  const fixedAccessMenus = FIXED_ACCESS_KEYS;
  const writableMenus = PERMISSION_MENUS.filter((m) => m.writable).map((m) => m.key);
  const approvableMenus = PERMISSION_MENUS.filter((m) => m.approvable).map((m) => m.key);

  useEffect(() => {
    if (selectedRole && active) {
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
  }, [selectedRole, active]);

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

  return (
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
  );
}

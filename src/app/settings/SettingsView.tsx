"use client";

import { useEffect, useState } from "react";
import { Key, Users, Shield, Mail, ShieldCheck, AlertTriangle } from "lucide-react";
import { PasswordTab } from "./tabs/PasswordTab";
import { MfaTab } from "./tabs/MfaTab";
import { UsersTab } from "./tabs/UsersTab";
import { TeamsTab } from "./tabs/TeamsTab";
import { PermissionsTab } from "./tabs/PermissionsTab";
import { MailTab } from "./tabs/MailTab";
import type { User, Team } from "./tabs/types";

type Tab = "password" | "mfa" | "users" | "teams" | "permissions" | "mail";

interface Props {
  currentUser: { userId: number; username: string; displayName: string; role: string } | null;
  users: User[];
  teams: Team[];
}

const TABS: Array<{ key: Tab; label: string; icon: React.ElementType; adminOnly: boolean }> = [
  { key: "password", label: "비밀번호 변경", icon: Key, adminOnly: false },
  { key: "mfa", label: "2단계 인증", icon: ShieldCheck, adminOnly: false },
  { key: "users", label: "사용자 관리", icon: Users, adminOnly: true },
  { key: "teams", label: "팀 관리", icon: Users, adminOnly: true },
  { key: "permissions", label: "메뉴 권한", icon: Shield, adminOnly: true },
  { key: "mail", label: "메일 설정", icon: Mail, adminOnly: true },
];

export function SettingsView({ currentUser, users: initialUsers, teams: initialTeams }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("password");
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  // 2단계 인증 등록 강제(MFA_REQUIRED_ROLES)로 미들웨어가 보낸 경우: ?tab=mfa&required=1
  const [mfaRequired, setMfaRequired] = useState(false);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const tab = sp.get("tab");
    if (tab && TABS.some((t) => t.key === tab)) setActiveTab(tab as Tab);
    setMfaRequired(sp.get("required") === "1");
  }, []);

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

      {mfaRequired && (
        <div className="flex items-start gap-2 text-sm bg-amber-50 text-warn border border-amber-100 rounded-lg px-4 py-3">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>
            <strong>현재 역할은 2단계 인증 등록이 필수</strong>입니다. 아래에서 인증 앱을 등록해야 다른 화면을 쓸 수 있습니다.
          </span>
        </div>
      )}

      {/* 탭 */}
      <div className="flex gap-1 border-b border-line">
        {TABS.filter((t) => !t.adminOnly || isAdmin).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key
                ? "border-signal text-ink"
                : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            <span className="flex items-center gap-1.5"><t.icon size={16} /> {t.label}</span>
          </button>
        ))}
      </div>

      {/* 각 탭은 activeTab 전환 시에도 로컬 state 를 잃지 않도록 조건부 렌더 대신 hidden 처리로 마운트를 유지한다. */}
      <div className={activeTab === "password" ? "" : "hidden"}>
        <PasswordTab />
      </div>
      <div className={activeTab === "mfa" ? "" : "hidden"}>
        <MfaTab active={activeTab === "mfa"} />
      </div>
      {isAdmin && (
        <div className={activeTab === "users" ? "" : "hidden"}>
          <UsersTab users={users} onUsersChange={setUsers} teams={teams} onTeamsChange={setTeams} />
        </div>
      )}
      {isAdmin && (
        <div className={activeTab === "teams" ? "" : "hidden"}>
          <TeamsTab teams={teams} onTeamsChange={setTeams} />
        </div>
      )}
      {isAdmin && (
        <div className={activeTab === "permissions" ? "" : "hidden"}>
          <PermissionsTab active={activeTab === "permissions"} />
        </div>
      )}
      {isAdmin && (
        <div className={activeTab === "mail" ? "" : "hidden"}>
          <MailTab active={activeTab === "mail"} />
        </div>
      )}
    </div>
  );
}

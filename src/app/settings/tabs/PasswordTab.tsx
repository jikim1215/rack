"use client";

import { useState } from "react";
import { Key } from "lucide-react";
import { sha512 } from "@/lib/sha512";
import { validatePasswordPolicy } from "@/lib/password-policy";

export function PasswordTab() {
  // --- 비밀번호 변경 ---
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwError, setPwError] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg("");
    setPwError(false);

    if (newPw !== confirmPw) {
      setPwMsg("새 비밀번호가 일치하지 않습니다.");
      setPwError(true);
      return;
    }
    // 정책은 평문을 아는 여기서만 검사할 수 있다(서버는 sha512 프리해시만 받는다) — 서버와 같은 규칙
    const policyError = validatePasswordPolicy(newPw);
    if (policyError) {
      setPwMsg(policyError);
      setPwError(true);
      return;
    }
    if (newPw === currentPw) {
      setPwMsg("새 비밀번호는 현재 비밀번호와 달라야 합니다.");
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

  return (
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
  );
}

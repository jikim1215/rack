"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogIn } from "lucide-react";
import { sha512 } from "@/lib/sha512";

// 비밀번호 변경 화면. 관리자 초기화(must_change_password)로 강제 진입하거나, 사용자가 직접 변경.
// 강제 진입 시 미들웨어가 /change-password 외 모든 경로를 막으므로 여기서 변경을 마쳐야 콘솔로 돌아간다.
export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setError(false);
    if (newPw !== confirmPw) {
      setMsg("새 비밀번호가 일치하지 않습니다.");
      setError(true);
      return;
    }
    if (newPw.length < 8) {
      setMsg("비밀번호는 8자 이상이어야 합니다.");
      setError(true);
      return;
    }
    if (newPw === currentPw) {
      setMsg("새 비밀번호는 현재 비밀번호와 달라야 합니다.");
      setError(true);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: await sha512(currentPw),
          newPassword: await sha512(newPw),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // 쿠키가 강제변경 해제된 새 토큰으로 재발급됨 → 콘솔로 이동.
        router.push("/");
        router.refresh();
      } else {
        setMsg(data.error || "변경에 실패했습니다.");
        setError(true);
      }
    } catch {
      setMsg("서버 연결에 실패했습니다.");
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch { /* 무시 */ }
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-rail px-4">
      <div className="w-full max-w-sm">
        <div className="panel overflow-hidden">
          <div className="panel-head bg-surface">
            <span className="led led-up led-live" />
            <span className="eyebrow">PASSWORD CHANGE REQUIRED</span>
          </div>
          <div className="p-8">
            <h1 className="text-xl font-bold tracking-tight text-ink flex items-center gap-2">
              <KeyRound size={20} /> 비밀번호 변경
            </h1>
            <p className="text-sm text-ink-2 mt-1 mb-6">
              임시 비밀번호로 로그인했습니다. 새 비밀번호를 설정해야 계속할 수 있습니다.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1">현재(임시) 비밀번호</label>
                <input
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className="form-input"
                  autoFocus
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
                  placeholder="8자 이상"
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
              {msg && (
                <p className={`text-sm ${error ? "text-fault" : "text-signal"}`}>{msg}</p>
              )}
              <button type="submit" disabled={loading} className="btn-ink w-full">
                <KeyRound size={16} />
                {loading ? "변경 중..." : "비밀번호 변경"}
              </button>
            </form>
            <button
              onClick={handleLogout}
              className="mt-4 w-full text-sm text-ink-3 hover:text-ink flex items-center justify-center gap-1.5"
            >
              <LogIn size={14} /> 다른 계정으로 로그인
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

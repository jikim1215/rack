"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn, ShieldCheck, ArrowLeft } from "lucide-react";
import { sha512 } from "@/lib/sha512";
import { validatePasswordPolicy } from "@/lib/password-policy";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // 2단계 인증: 비밀번호가 맞으면 서버가 mfaRequired 를 돌려주고, 코드 입력 단계로 넘어간다.
  const [mfaStep, setMfaStep] = useState(false);
  const [code, setCode] = useState("");
  // 평문 비밀번호는 서버가 못 본다(sha512 프리해시). 정책 이전의 취약 비밀번호를 여기서 감지해
  // 로그인 완료 직후 강제 변경을 켬다. MFA 단계를 거치는 동안 판정값만 보관(평문은 화면에서 지운다).
  const weakPasswordRef = useRef(false);

  async function goAfterLogin(data: { mfaSetupRequired?: boolean } = {}) {
    if (weakPasswordRef.current) {
      // 서버가 must_change_password 를 켜고 세션을 mcp 로 재발급 → 미들웨어가 변경 화면 밖을 막는다
      await fetch("/api/auth/password/weak", { method: "POST" }).catch(() => {});
      router.push("/change-password?weak=1");
      router.refresh();
      return;
    }
    if (data.mfaSetupRequired) {
      router.push("/settings?tab=mfa&required=1");
      router.refresh();
      return;
    }
    const redirect = searchParams.get("redirect") || "/";
    router.push(redirect);
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const hashedPassword = await sha512(password);
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: hashedPassword }),
      });
      const data = await res.json();

      // ⚠ res.ok 로 판단하면 안 된다 — 2단계 인증 필요는 "비밀번호는 맞았다"라 HTTP 200 이다.
      //   상태코드가 아니라 본문의 ok 를 성공 신호로 쓴다(200 ≠ 로그인 완료).
      weakPasswordRef.current = validatePasswordPolicy(password) !== null;
      if (data.ok) {
        await goAfterLogin(data);
      } else if (data.mfaRequired) {
        setMfaStep(true);
        setPassword("");
      } else {
        setError(data.error || "로그인에 실패했습니다.");
      }
    } catch {
      setError("서버 연결에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        if (data.method === "backup") {
          alert(`백업 코드로 로그인했습니다. 남은 백업 코드 ${data.backupCodesLeft}개.\n설정 → 2단계 인증에서 인증 앱을 다시 등록하세요.`);
        }
        await goAfterLogin();
      } else {
        setError(data.error || "인증에 실패했습니다.");
        setCode("");
      }
    } catch {
      setError("서버 연결에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  if (mfaStep) {
    return (
      <form onSubmit={handleMfaSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 text-fault text-sm px-4 py-2 rounded-lg border border-red-100">{error}</div>
        )}
        <div className="flex items-center gap-2 text-ink-2 text-sm">
          <ShieldCheck size={16} className="text-signal" />
          2단계 인증
        </div>
        <p className="text-xs text-ink-3 -mt-2">
          인증 앱에 표시된 <strong className="text-ink-2">6자리 코드</strong>를 입력하세요. 앱을 쓸 수 없으면 백업 코드(XXXX-XXXX)도 됩니다.
        </p>
        <div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="form-input num text-center text-lg tracking-[0.4em]"
            placeholder="000000"
            inputMode="text"
            autoComplete="one-time-code"
            autoFocus
            required
          />
        </div>
        <button type="submit" disabled={loading} className="btn-ink w-full">
          <ShieldCheck size={16} />
          {loading ? "확인 중..." : "확인"}
        </button>
        <button
          type="button"
          onClick={() => { setMfaStep(false); setCode(""); setError(""); }}
          className="w-full text-xs text-ink-3 hover:text-ink inline-flex items-center justify-center gap-1"
        >
          <ArrowLeft size={12} /> 취소하고 다시 로그인
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-50 text-fault text-sm px-4 py-2 rounded-lg border border-red-100">{error}</div>
      )}
      <div>
        <label className="block text-sm font-medium text-ink-2 mb-1">이메일</label>
        <input
          type="email"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="form-input"
          placeholder="name@example.go.kr"
          autoFocus
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-ink-2 mb-1">비밀번호</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="form-input"
          placeholder="••••••••"
          required
        />
      </div>
      <button type="submit" disabled={loading} className="btn-ink w-full">
        <LogIn size={16} />
        {loading ? "로그인 중..." : "로그인"}
      </button>
    </form>
  );
}

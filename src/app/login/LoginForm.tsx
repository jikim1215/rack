"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn } from "lucide-react";
import { sha512 } from "@/lib/sha512";
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

      if (res.ok) {
        const redirect = searchParams.get("redirect") || "/";
        router.push(redirect);
        router.refresh();
      } else {
        setError(data.error || "로그인에 실패했습니다.");
      }
    } catch {
      setError("서버 연결에 실패했습니다.");
    } finally {
      setLoading(false);
    }
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

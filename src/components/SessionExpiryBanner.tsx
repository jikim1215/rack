"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";

/**
 * 세션 만료 임박 배너 (외부 검토 P0 합의): 401 리다이렉트로 작성 중 입력이 유실되기 전에 경고한다.
 * - 만료 10분 전부터 상단 고정 배너 노출 (남은 분 표시)
 * - 만료 후에는 "다시 로그인" 안내로 전환
 * - 만료 시각은 /api/auth/me 의 exp(HMAC 페이로드) 기준 — 클라이언트 시계 오차는 분 단위 표시라 무해
 */
const WARN_BEFORE_MS = 10 * 60 * 1000;

export function SessionExpiryBanner() {
  const [exp, setExp] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.exp) setExp(d.exp); })
      .catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (exp == null) return null;
  const remain = exp - now;
  if (remain > WARN_BEFORE_MS) return null;

  const expired = remain <= 0;
  const mins = Math.max(1, Math.ceil(remain / 60_000));
  return (
    <div className={`flex items-center gap-2 px-4 py-2 text-sm border-b ${expired ? "bg-red-50 text-fault border-fault/30" : "bg-amber-50 text-warn border-warn/30"}`}>
      <AlertCircle size={15} className="shrink-0" />
      {expired ? (
        <span>
          세션이 만료되었습니다. 저장하지 않은 입력은 사라집니다 —{" "}
          <a href="/login" className="underline font-medium">다시 로그인</a>
        </span>
      ) : (
        <>
          <span>
            세션이 약 <strong className="num">{mins}분</strong> 후 만료됩니다. 계속 작업하려면 연장하세요. (만료 시 저장 안 된 입력은 사라집니다)
          </span>
          <button
            className="underline font-medium hover:opacity-80"
            onClick={async () => {
              const res = await fetch("/api/auth/refresh", { method: "POST" });
              if (res.ok) { const d = await res.json(); setExp(d.exp); }
              else location.href = "/login";
            }}
          >
            세션 연장
          </button>
        </>
      )}
    </div>
  );
}

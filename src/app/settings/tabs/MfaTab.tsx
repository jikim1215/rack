"use client";

// 2단계 인증(TOTP) 등록/해제 — 본인 계정. 폐쇄망이라 인증 앱은 서버와 통신하지 않는다(시간 기반).
// 흐름: [시작] → 시크릿 발급(아직 꺼짐) → 인증 앱에 등록 → 6자리 코드 확인 → 활성화 + 백업 코드 1회 표시
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldOff, Copy, Check, AlertTriangle, KeyRound } from "lucide-react";

interface Status {
  enabled: boolean;
  pendingSetup: boolean;
  backupCodesLeft: number;
}

export function MfaTab({ active }: { active: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [secret, setSecret] = useState<{ secret: string; secretDisplay: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/auth/mfa/setup");
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => { if (active) load(); }, [active, load]);

  function say(text: string, isError = false) {
    setMsg(text);
    setError(isError);
  }

  async function start() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mfa/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) return say(data.error || "시작할 수 없습니다.", true);
      setSecret(data);
      setBackupCodes(null);
      say("");
    } finally { setLoading(false); }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mfa/setup", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) return say(data.error || "확인에 실패했습니다.", true);
      setBackupCodes(data.backupCodes);
      setSecret(null);
      setCode("");
      say("2단계 인증이 켜졌습니다. 아래 백업 코드를 안전한 곳에 보관하세요 — 다시 볼 수 없습니다.");
      load();
    } finally { setLoading(false); }
  }

  async function disable() {
    const enteredCode = status?.enabled
      ? prompt("해제하려면 현재 인증 코드 6자리를 입력하세요.\n(백업 코드로는 해제할 수 없습니다)")
      : "";
    if (status?.enabled && !enteredCode) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mfa/setup", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: enteredCode || "" }),
      });
      const data = await res.json();
      if (!res.ok) return say(data.error || "해제에 실패했습니다.", true);
      setSecret(null);
      setBackupCodes(null);
      say("2단계 인증을 해제했습니다.");
      load();
    } finally { setLoading(false); }
  }

  function copySecret() {
    if (!secret) return;
    navigator.clipboard?.writeText(secret.secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  return (
    <div className="panel p-6 space-y-5">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <ShieldCheck size={18} className="text-signal" /> 2단계 인증
        </h3>
        <p className="text-sm text-ink-3 mt-1">
          비밀번호에 더해 인증 앱의 6자리 코드를 요구합니다. 인증 앱은 서버와 통신하지 않아 폐쇄망에서도 동작합니다.
        </p>
      </div>

      {msg && (
        <div className={`text-sm px-4 py-2 rounded-lg border ${error ? "bg-red-50 text-fault border-red-100" : "bg-signal/5 text-signal border-signal/20"}`}>
          {msg}
        </div>
      )}

      {/* 현재 상태 */}
      {status && !secret && !backupCodes && (
        <div className="flex items-center justify-between border border-line rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            {status.enabled ? (
              <>
                <span className="led led-up" />
                <span className="font-medium text-ink">사용 중</span>
                <span className="text-ink-3">· 남은 백업 코드 <span className="num">{status.backupCodesLeft}</span>개</span>
              </>
            ) : (
              <>
                <span className="led led-idle" />
                <span className="text-ink-2">사용 안 함</span>
                {status.pendingSetup && <span className="text-warn text-xs">(등록 진행 중 — 코드 확인 필요)</span>}
              </>
            )}
          </div>
          {status.enabled ? (
            <button onClick={disable} disabled={loading} className="px-3 py-1.5 rounded text-sm text-fault hover:bg-fault/10 inline-flex items-center gap-1.5">
              <ShieldOff size={15} /> 해제
            </button>
          ) : (
            <button onClick={start} disabled={loading} className="btn-ink !py-1.5">
              <ShieldCheck size={15} /> {status.pendingSetup ? "다시 시작" : "설정 시작"}
            </button>
          )}
        </div>
      )}

      {status?.enabled && status.backupCodesLeft <= 2 && !backupCodes && (
        <div className="flex items-start gap-2 text-sm bg-amber-50 text-warn border border-amber-100 rounded-lg px-4 py-3">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>백업 코드가 {status.backupCodesLeft}개 남았습니다. 기기를 잃으면 로그인할 수 없게 됩니다 — 해제 후 다시 등록하면 새 백업 코드를 받습니다.</span>
        </div>
      )}

      {/* 등록 단계 */}
      {secret && (
        <form onSubmit={confirm} className="space-y-4 border border-line rounded-lg p-4">
          <div>
            <p className="text-sm font-medium text-ink-2 mb-2">1. 인증 앱에 아래 키를 등록하세요</p>
            <p className="text-xs text-ink-3 mb-2">
              Google Authenticator · Microsoft Authenticator 등에서 &ldquo;직접 입력(수동 추가)&rdquo; 을 선택하고 아래 키를 입력합니다.
            </p>
            <div className="flex items-center gap-2">
              <code className="num flex-1 bg-surface border border-line rounded px-3 py-2 text-sm tracking-wider break-all">
                {secret.secretDisplay}
              </code>
              <button type="button" onClick={copySecret} className="px-2 py-2 rounded border border-line text-ink-2 hover:bg-slate-50" title="클립보드에 복사">
                {copied ? <Check size={15} className="text-signal" /> : <Copy size={15} />}
              </button>
            </div>
            <details className="mt-2">
              <summary className="text-xs text-ink-3 cursor-pointer">otpauth 주소로 등록하기</summary>
              <code className="block mt-1 text-[11px] text-ink-3 break-all bg-surface border border-line rounded px-2 py-1.5">
                {secret.otpauthUri}
              </code>
            </details>
            <p className="text-[11px] text-ink-3 mt-2">계정명 · 6자리 · 30초 · SHA1 (대부분 앱의 기본값)</p>
          </div>
          <div>
            <p className="text-sm font-medium text-ink-2 mb-2">2. 앱에 표시된 6자리 코드를 입력하세요</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="form-input num text-center text-lg tracking-[0.4em] !w-48"
              placeholder="000000"
              inputMode="numeric"
              autoFocus
              required
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="btn-ink">
              <ShieldCheck size={15} /> {loading ? "확인 중..." : "확인하고 켜기"}
            </button>
            <button type="button" onClick={() => { setSecret(null); setCode(""); }} className="px-3 py-2 text-sm text-ink-2 hover:text-ink">
              취소
            </button>
          </div>
        </form>
      )}

      {/* 백업 코드 (1회 표시) */}
      {backupCodes && (
        <div className="border-2 border-signal/30 rounded-lg p-4 bg-signal/5">
          <p className="text-sm font-semibold flex items-center gap-1.5 text-ink">
            <KeyRound size={16} className="text-signal" /> 백업 코드 — 지금 저장하세요
          </p>
          <p className="text-xs text-ink-2 mt-1 mb-3">
            인증 앱을 쓸 수 없을 때 1회씩 사용합니다. <strong>이 화면을 벗어나면 다시 볼 수 없습니다.</strong> 인쇄하거나 안전한 곳에 보관하세요.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {backupCodes.map((c) => (
              <code key={c} className="num text-sm bg-panel border border-line rounded px-2 py-1.5 text-center">{c}</code>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => navigator.clipboard?.writeText(backupCodes.join("\n")).catch(() => {})}
              className="px-3 py-1.5 rounded border border-line text-sm text-ink-2 hover:bg-slate-50 inline-flex items-center gap-1.5"
            >
              <Copy size={14} /> 전체 복사
            </button>
            <button onClick={() => window.print()} className="px-3 py-1.5 rounded border border-line text-sm text-ink-2 hover:bg-slate-50">
              인쇄
            </button>
            <button onClick={() => setBackupCodes(null)} className="ml-auto px-3 py-1.5 text-sm text-ink-3 hover:text-ink">
              저장했습니다
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-ink-3 border-t border-line pt-3">
        기기를 잃고 백업 코드도 없으면 총괄에게 해제를 요청하세요 (설정 → 사용자 관리). 총괄 본인이 잠긴 경우는 서버에서 해제합니다.
      </p>
    </div>
  );
}

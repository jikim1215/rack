"use client";

import { useState, useEffect } from "react";
import { Mail, Save } from "lucide-react";

interface Props {
  active: boolean;
}

export function MailTab({ active }: Props) {
  // --- 메일 릴레이 설정 (admin) ---
  const [mail, setMail] = useState<{ host: string; port: number; security: string; from_address: string; from_name: string; base_url: string; enabled: boolean }>({ host: "", port: 25, security: "NONE", from_address: "", from_name: "", base_url: "", enabled: false });
  const [mailMsg, setMailMsg] = useState("");
  const [mailError, setMailError] = useState(false);
  const [mailLoading, setMailLoading] = useState(false);
  const [mailChannelOff, setMailChannelOff] = useState(false);
  const [testTo, setTestTo] = useState("");

  useEffect(() => {
    if (!active) return;
    fetch("/api/admin/mail-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setMail({ host: d.host ?? "", port: d.port ?? 25, security: d.security ?? "NONE", from_address: d.from_address ?? "", from_name: d.from_name ?? "", base_url: d.base_url ?? "", enabled: !!d.enabled });
        setMailChannelOff(!!d.channel_forced_off);
      })
      .catch(() => {});
  }, [active]);

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

  return (
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
  );
}

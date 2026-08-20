// ── SMTP 릴레이 발송 어댑터 (nodemailer) ──
// 순수 로직(설정/검증/옵션 매핑)은 mail-config.ts. 본 모듈은 nodemailer 의존.
// 발송 실패는 throw — 호출측이 best-effort(초기화 통지 등) 로 감싸 감사/무시한다.
import nodemailer from "nodemailer";
import { getDb } from "@/lib/db";
import { transportOptions, formatFrom, type MailRelayConfig } from "@/lib/mail-config";

export { isEmailEnabled, absoluteUrl } from "@/lib/mail-config";
export type { MailRelayConfig };

// 단일행(id=1) 메일 설정 로드. 미설정이면 null.
export function loadMailRelayConfig(): MailRelayConfig | null {
  const row = getDb()
    .prepare(
      "SELECT host, port, security, from_address, from_name, base_url, enabled FROM mail_relay_config WHERE id = 1"
    )
    .get() as
    | { host: string; port: number; security: string; from_address: string; from_name: string; base_url: string; enabled: number }
    | undefined;
  if (!row) return null;
  return {
    host: row.host ?? "",
    port: row.port ?? 25,
    security: (row.security as MailRelayConfig["security"]) ?? "NONE",
    fromAddress: row.from_address ?? "",
    fromName: row.from_name ?? "",
    baseUrl: row.base_url ?? "",
    enabled: !!row.enabled,
  };
}

export async function sendEmail(
  config: MailRelayConfig,
  msg: { to: string; subject: string; text: string; html?: string },
): Promise<void> {
  const transport = nodemailer.createTransport(transportOptions(config));
  await transport.sendMail({
    from: formatFrom(config),
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}

// ── 메일 릴레이 설정 순수 로직 (단위테스트 대상) ──
// nodemailer 의존이 없어 테스트/라우트가 함께 임포트한다. 실제 발송 어댑터는 mailer.ts.
// 전제(공존시스템 규약): 폐쇄망 사내 SMTP 릴레이 = 허용 IP 방식·무인증(계정/비밀번호 없음).
// 용도: 알림 메일(비밀번호 초기화 통지 등) — 비밀번호 자체를 담지 않는다.
// 자기완결형(로컬 임포트 없음) — 이메일 형식은 아래 EMAIL_RE 로 검증(user-admin 과 동일 규약).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type MailSecurity = "NONE" | "STARTTLS" | "TLS";

export interface MailRelayConfig {
  host: string;
  port: number;
  security: MailSecurity;
  fromAddress: string;
  fromName: string;
  baseUrl: string;
  enabled: boolean;
}

const SECURITIES: readonly MailSecurity[] = ["NONE", "STARTTLS", "TLS"];

// 이메일 채널 마스터 스위치(운영 override). 미설정=ON, "email" 미포함=강제 OFF.
export function emailChannelActive(): boolean {
  const raw = process.env.NOTIFICATION_CHANNELS?.trim();
  if (!raw) return true;
  return raw.split(",").map((s) => s.trim()).includes("email");
}

// 실제 발송 가능 여부: 채널 활성 + enabled 토글 + 필수값(host/from/baseUrl) 완비.
export function isEmailEnabled(config: MailRelayConfig | null): config is MailRelayConfig {
  return (
    emailChannelActive() &&
    config !== null &&
    config.enabled &&
    !!config.host &&
    !!config.fromAddress &&
    !!config.baseUrl
  );
}

// nodemailer transport 옵션 매핑(순수). 폐쇄망 릴레이라 타임아웃을 짧게 둔다.
export function transportOptions(config: MailRelayConfig) {
  const base = {
    host: config.host,
    port: config.port,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  };
  if (config.security === "TLS") return { ...base, secure: true };
  if (config.security === "STARTTLS") return { ...base, secure: false, requireTLS: true };
  return { ...base, secure: false, ignoreTLS: true }; // NONE — 평문 릴레이
}

export function formatFrom(config: MailRelayConfig): string {
  return config.fromName ? `"${config.fromName}" <${config.fromAddress}>` : config.fromAddress;
}

// 인앱 상대경로 → 메일용 절대 URL. baseUrl 끝 슬래시 정규화.
export function absoluteUrl(config: MailRelayConfig, internalPath: string | null | undefined): string | null {
  if (!internalPath) return null;
  return `${config.baseUrl.replace(/\/+$/, "")}${internalPath}`;
}

// PUT /api/admin/mail-config 페이로드 검증·정규화. 오류메시지 또는 정규화된 설정.
export function validateMailConfig(input: unknown): { error: string } | { value: MailRelayConfig } {
  if (typeof input !== "object" || input === null) return { error: "잘못된 요청입니다." };
  const b = input as Record<string, unknown>;

  const host = typeof b.host === "string" ? b.host.trim() : "";
  const portNum = Number(b.port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return { error: "포트는 1~65535 사이의 정수여야 합니다." };
  }
  const security =
    typeof b.security === "string" && SECURITIES.includes(b.security as MailSecurity)
      ? (b.security as MailSecurity)
      : "NONE";
  const fromAddress = typeof b.from_address === "string" ? b.from_address.trim() : "";
  const fromName = typeof b.from_name === "string" ? b.from_name.trim() : "";
  const baseUrl = typeof b.base_url === "string" ? b.base_url.trim().replace(/\/+$/, "") : "";
  const enabled = !!b.enabled;

  if (fromAddress) {
    if (/\s/.test(fromAddress) || !EMAIL_RE.test(fromAddress)) {
      return { error: "발신 주소가 올바른 이메일 형식이 아닙니다." };
    }
  }
  if (baseUrl && !/^https?:\/\/\S+$/.test(baseUrl)) {
    return { error: "기준 URL은 http:// 또는 https:// 로 시작해야 합니다." };
  }
  // 활성화하려면 필수값 완비.
  if (enabled) {
    if (!host) return { error: "메일을 활성화하려면 SMTP 호스트가 필요합니다." };
    if (!fromAddress) return { error: "메일을 활성화하려면 발신 주소가 필요합니다." };
    if (!baseUrl) return { error: "메일을 활성화하려면 기준 URL이 필요합니다." };
  }

  return { value: { host, port: portNum, security, fromAddress, fromName, baseUrl, enabled } };
}

// tests/mail-config.test.ts — 메일 릴레이 설정 순수 로직 단위테스트
// 실행: node --experimental-strip-types --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emailChannelActive,
  isEmailEnabled,
  transportOptions,
  formatFrom,
  absoluteUrl,
  validateMailConfig,
  type MailRelayConfig,
} from "../src/lib/mail-config.ts";

const full: MailRelayConfig = {
  host: "relay.example.go.kr",
  port: 25,
  security: "NONE",
  fromAddress: "noreply@example.go.kr",
  fromName: "자산관리",
  baseUrl: "https://itam.example.go.kr",
  enabled: true,
};

function withEnv(val: string | undefined, fn: () => void) {
  const prev = process.env.NOTIFICATION_CHANNELS;
  if (val === undefined) delete process.env.NOTIFICATION_CHANNELS;
  else process.env.NOTIFICATION_CHANNELS = val;
  try { fn(); } finally {
    if (prev === undefined) delete process.env.NOTIFICATION_CHANNELS;
    else process.env.NOTIFICATION_CHANNELS = prev;
  }
}

test("emailChannelActive: 미설정=ON, email 포함=ON, 미포함=OFF", () => {
  withEnv(undefined, () => assert.equal(emailChannelActive(), true));
  withEnv("inapp,email", () => assert.equal(emailChannelActive(), true));
  withEnv("inapp", () => assert.equal(emailChannelActive(), false));
  withEnv("", () => assert.equal(emailChannelActive(), true));
});

test("isEmailEnabled: 채널 ON + enabled + 필수값 완비만 true", () => {
  withEnv(undefined, () => {
    assert.equal(isEmailEnabled(full), true);
    assert.equal(isEmailEnabled(null), false);
    assert.equal(isEmailEnabled({ ...full, enabled: false }), false);
    assert.equal(isEmailEnabled({ ...full, host: "" }), false);
    assert.equal(isEmailEnabled({ ...full, fromAddress: "" }), false);
    assert.equal(isEmailEnabled({ ...full, baseUrl: "" }), false);
  });
  // 마스터 스위치로 강제 OFF면 완비돼도 false
  withEnv("inapp", () => assert.equal(isEmailEnabled(full), false));
});

test("transportOptions: 보안 모드별 매핑 + 타임아웃", () => {
  const tls = transportOptions({ ...full, security: "TLS" });
  assert.equal(tls.secure, true);
  assert.equal(tls.host, full.host);
  assert.equal(tls.port, 25);
  assert.equal(tls.connectionTimeout, 10000);

  const starttls = transportOptions({ ...full, security: "STARTTLS" }) as Record<string, unknown>;
  assert.equal(starttls.secure, false);
  assert.equal(starttls.requireTLS, true);

  const none = transportOptions({ ...full, security: "NONE" }) as Record<string, unknown>;
  assert.equal(none.secure, false);
  assert.equal(none.ignoreTLS, true);
});

test("formatFrom / absoluteUrl", () => {
  assert.equal(formatFrom(full), '"자산관리" <noreply@example.go.kr>');
  assert.equal(formatFrom({ ...full, fromName: "" }), "noreply@example.go.kr");
  assert.equal(absoluteUrl(full, "/login"), "https://itam.example.go.kr/login");
  assert.equal(absoluteUrl({ ...full, baseUrl: "https://itam.example.go.kr/" }, "/login"), "https://itam.example.go.kr/login");
  assert.equal(absoluteUrl(full, null), null);
});

test("validateMailConfig: 정상 입력 정규화", () => {
  const r = validateMailConfig({
    host: "  relay.example.go.kr ", port: 587, security: "STARTTLS",
    from_address: " Noreply@example.go.kr ", from_name: " 자산 ", base_url: "https://itam.example.go.kr/", enabled: true,
  });
  assert.ok("value" in r);
  if ("value" in r) {
    assert.equal(r.value.host, "relay.example.go.kr");
    assert.equal(r.value.port, 587);
    assert.equal(r.value.security, "STARTTLS");
    assert.equal(r.value.baseUrl, "https://itam.example.go.kr"); // 끝 슬래시 제거
    assert.equal(r.value.enabled, true);
  }
});

test("validateMailConfig: 포트 경계/형식 거부", () => {
  assert.ok("error" in validateMailConfig({ port: 0 }));
  assert.ok("error" in validateMailConfig({ port: 70000 }));
  assert.ok("error" in validateMailConfig({ port: 25.5 }));
  assert.ok("error" in validateMailConfig("nope"));
});

test("validateMailConfig: 발신주소/기준URL 형식 검증", () => {
  assert.ok("error" in validateMailConfig({ port: 25, from_address: "not-an-email" }));
  assert.ok("error" in validateMailConfig({ port: 25, base_url: "ftp://x" }));
});

test("validateMailConfig: 활성화 시 필수값 강제", () => {
  // enabled=true 인데 host 없음 → 오류
  assert.ok("error" in validateMailConfig({ port: 25, enabled: true, from_address: "a@b.co", base_url: "https://x.y" }));
  // enabled=false 면 부분 저장 허용
  assert.ok("value" in validateMailConfig({ port: 25, enabled: false, host: "" }));
});

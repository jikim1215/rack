// tests/access-log.test.ts — clientMeta: 프록시 헤더에서 클라이언트 IP 추출 (위조 방지)
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { clientMeta } from "../src/lib/access-log.ts";

const req = (headers: Record<string, string>) => new Request("http://localhost/api/auth/login", { headers });
const prev = process.env.TRUST_PROXY;
afterEach(() => {
  if (prev === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = prev;
});

test("TRUST_PROXY 미설정: 헤더 무시하고 direct", () => {
  delete process.env.TRUST_PROXY;
  assert.equal(clientMeta(req({ "x-real-ip": "10.0.0.5", "x-forwarded-for": "10.0.0.5" })).ip, "direct");
});

test("TRUST_PROXY: X-Real-IP(프록시가 덮어씀)를 XFF 보다 우선", () => {
  process.env.TRUST_PROXY = "true";
  assert.equal(clientMeta(req({ "x-real-ip": "192.168.1.20", "x-forwarded-for": "10.0.0.5, 192.168.1.20" })).ip, "192.168.1.20");
});

test("TRUST_PROXY: X-Real-IP 없으면 XFF 맨 끝(직전 프록시가 붙인 값) — 클라이언트가 앞에 넣은 위조값 무시", () => {
  process.env.TRUST_PROXY = "true";
  assert.equal(clientMeta(req({ "x-forwarded-for": "10.0.0.5, 192.168.1.20" })).ip, "192.168.1.20");
  assert.equal(clientMeta(req({ "x-forwarded-for": " 192.168.1.20 " })).ip, "192.168.1.20");
});

test("TRUST_PROXY: 헤더 전무하면 direct", () => {
  process.env.TRUST_PROXY = "true";
  assert.equal(clientMeta(req({})).ip, "direct");
  assert.equal(clientMeta(req({ "x-forwarded-for": " , " })).ip, "direct");
});

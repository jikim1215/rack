#!/usr/bin/env node
// G012 (P12/AC-21) Node 내장 TLS HTTPS 종단 + HTTP→HTTPS 리다이렉트 (외부 reverse proxy 미동봉, ADR-008).
// 폐쇄망 단일 서버: 내부적으로 Next standalone(HTTP, localhost:NEXT_INTERNAL_PORT)을 자식 프로세스로 기동하고,
// 그 앞에 Node https 서버(HTTPS_PORT)로 TLS 종단 + 프록시. HTTP_PORT는 HTTPS로 301 리다이렉트.
// 모두 Node 내장 모듈(https/http/child_process/fs)만 사용 — 외부 의존 0.
//
// env: TLS_KEY_PATH, TLS_CERT_PATH (필수), HTTPS_PORT(기본 443), HTTP_PORT(기본 80),
//      NEXT_INTERNAL_PORT(기본 3000), NEXT_SERVER(기본 ./.next/standalone/server.js)
import https from "node:https";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const HTTPS_PORT = Number(process.env.HTTPS_PORT || 443);
const HTTP_PORT = Number(process.env.HTTP_PORT || 80);
const NEXT_PORT = Number(process.env.NEXT_INTERNAL_PORT || 3000);
const KEY = process.env.TLS_KEY_PATH;
const CERT = process.env.TLS_CERT_PATH;
const NEXT_SERVER = process.env.NEXT_SERVER || join(process.cwd(), ".next", "standalone", "server.js");

if (!KEY || !CERT || !existsSync(KEY) || !existsSync(CERT)) {
  console.error(`[tls] TLS_KEY_PATH/TLS_CERT_PATH 필요(존재해야 함): key=${KEY} cert=${CERT}`);
  process.exit(1);
}

// 1) Next standalone(HTTP, 내부 포트) 자식 기동
const child = spawn(process.execPath, [NEXT_SERVER], {
  env: { ...process.env, PORT: String(NEXT_PORT), HOSTNAME: "127.0.0.1", NODE_ENV: "production", COOKIE_SECURE: "true" },
  stdio: "inherit",
});
child.on("exit", (code) => { console.error(`[tls] next 내부 서버 종료(code=${code}) — TLS 종단 종료`); process.exit(code ?? 1); });
process.on("SIGTERM", () => { child.kill("SIGTERM"); });
process.on("SIGINT", () => { child.kill("SIGINT"); });

// 2) TLS 종단 → 내부 Next로 프록시
function proxy(req, res) {
  const opts = {
    hostname: "127.0.0.1", port: NEXT_PORT, path: req.url, method: req.method,
    headers: { ...req.headers, "x-forwarded-proto": "https", "x-forwarded-host": req.headers.host || "" },
  };
  const up = http.request(opts, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  up.on("error", () => { res.writeHead(502); res.end("upstream error"); });
  req.pipe(up);
}

const tlsServer = https.createServer({ key: readFileSync(KEY), cert: readFileSync(CERT) }, proxy);
tlsServer.listen(HTTPS_PORT, () => console.log(`[tls] HTTPS :${HTTPS_PORT} → 내부 Next :${NEXT_PORT}`));

// 3) HTTP → HTTPS 301 리다이렉트
const redir = http.createServer((req, res) => {
  const host = (req.headers.host || "").replace(/:\d+$/, "");
  const loc = HTTPS_PORT === 443 ? `https://${host}${req.url}` : `https://${host}:${HTTPS_PORT}${req.url}`;
  res.writeHead(301, { Location: loc });
  res.end();
});
redir.listen(HTTP_PORT, () => console.log(`[tls] HTTP :${HTTP_PORT} → HTTPS 301`));

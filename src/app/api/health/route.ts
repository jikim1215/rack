import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withApi } from "@/lib/api-authz";
import { APP_BUILD } from "@/lib/app-build";
import { isLocalHealthProbe } from "@/lib/health-access";

// ── 헬스체크 (인증 불필요, 미들웨어 예외) ──
// 외부(nginx 경유)에는 가동 여부만 낸다: {"ok":true} + 200/503. 버전·커밋·빌드 시각·스키마·가동 시간·지연은
// 정찰 정보라(취약 판 특정·패치 주기 추정) 서버 안에서 앱 포트로 직접 부른 경우에만 낸다 — 배포·업그레이드·롤백
// 스크립트가 "지금 도는 판"을 확인하는 경로(curl http://127.0.0.1:<PORT>/api/health). 판정 규칙은 lib/health-access.ts.
// DB 는 실제로 읽어 본다(연결만이 아니라 스키마 마이그레이션까지 끝났는지).
export const GET = withApi(async (req: NextRequest) => {
  const started = Date.now();
  let db: "ok" | "error" = "ok";
  let schema = -1;
  try {
    const d = getDb();
    d.prepare("SELECT 1").get();
    schema = Number(d.pragma("user_version", { simple: true }));
  } catch {
    db = "error";
  }
  const ok = db === "ok";
  const headers = { "Cache-Control": "no-store" };
  const status = ok ? 200 : 503;
  if (!isLocalHealthProbe(req.headers, process.env.TRUST_PROXY)) {
    return NextResponse.json({ ok }, { status, headers });
  }
  return NextResponse.json(
    {
      ok,
      db,
      schema,
      version: APP_BUILD.version || "unknown",
      commit: APP_BUILD.commit,
      builtAt: APP_BUILD.builtAt,
      uptimeSec: Math.floor(process.uptime()),
      latencyMs: Date.now() - started,
    },
    { status, headers },
  );
});

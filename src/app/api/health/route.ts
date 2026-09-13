import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withApi } from "@/lib/api-authz";
import pkg from "../../../../package.json";

// ── 헬스체크 (인증 불필요, 미들웨어 예외) ──
// nginx upstream 점검·배포 스크립트 스모크·모니터링이 HTML 을 긁는 대신 이걸 본다.
// DB 는 실제로 읽어 본다(연결만이 아니라 스키마 마이그레이션까지 끝났는지: user_version 노출).
// 정보 노출 최소화: 버전·DB 상태·스키마 버전만. 사용자 수·자산 수 같은 업무 정보는 내지 않는다.
export const GET = withApi(async () => {
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
  const body = {
    ok: db === "ok",
    db,
    schema,
    version: (pkg as { version?: string }).version ?? "unknown",
    uptimeSec: Math.floor(process.uptime()),
    latencyMs: Date.now() - started,
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
});

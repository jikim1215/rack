import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi } from "@/lib/api-authz";
import { assertAdmin } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { pathId } from "@/lib/validation/input";
import type { UserRow } from "@/lib/db-types";

// ── 타인 계정의 2단계 인증 해제 (총괄 전용) ──
// 인증 앱이 든 기기를 분실하고 백업 코드도 없을 때의 유일한 탈출구. 해제하면 그 계정은
// 비밀번호만으로 로그인하게 되므로, 반드시 감사로그에 남기고 사용자에게 재등록을 요구해야 한다.
// (총괄 본인이 잠긴 경우는 서버 CLI: scripts/deploy/disable-mfa.cjs)
export const DELETE = withApi(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await getActor();
  assertAdmin(actor);
  const id = pathId((await params).id);
  const db = getDb();

  const user = db.prepare("SELECT id, username, totp_enabled FROM users WHERE id = ?").get(id) as
    | Pick<UserRow, "id" | "username" | "totp_enabled">
    | undefined;
  if (!user) return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });

  db.prepare("UPDATE users SET totp_secret = '', totp_enabled = 0, totp_last_counter = 0, backup_codes = '[]' WHERE id = ?").run(id);
  // 진행 중인 세션·MFA 대기 토큰 무효화 (해제 시점 이전 토큰이 살아있지 않게)
  db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(id);
  db.prepare("DELETE FROM login_attempts WHERE key = ? OR key = ?").run(`m:${user.username}`, `u:${user.username}`);

  logAudit(db, {
    entityType: "user", entityId: id, entityName: user.username,
    action: "update", changedBy: actor.username,
    oldData: { totp_enabled: user.totp_enabled }, newData: { totp_enabled: 0, mfa_reset_by_admin: 1 },
  });
  return NextResponse.json({ ok: true });
});

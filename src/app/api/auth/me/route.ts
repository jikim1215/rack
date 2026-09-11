import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/api-authz";
import { clientMeta } from "@/lib/access-log";
import type { MenuPermissionRow } from "@/lib/db-types";

export const GET = withApi(async (req: NextRequest) => {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const perms = db.prepare('SELECT menu_key, can_access, can_write, can_approve FROM menu_permissions WHERE role = ?').all(session.role) as
    Pick<MenuPermissionRow, "menu_key" | "can_access" | "can_write" | "can_approve">[];
  const permissions: Record<string, { can_access: number; can_write: number; can_approve: number }> = {};
  for (const p of perms) {
    permissions[p.menu_key] = { can_access: p.can_access, can_write: p.can_write, can_approve: p.can_approve };
  }
  // 현재 접속 IP (TRUST_PROXY=true 시 실제 클라이언트 IP, 아니면 "direct").
  //   관리자 UI 의 허용 IP 설정 화면에서 "자기 자신 차단 방지" 안내에 사용.
  const { ip } = clientMeta(req);
  return NextResponse.json({
    userId: session.userId,
    username: session.username,
    displayName: session.displayName,
    role: session.role,
    permissions,
    clientIp: ip,
    // 세션 만료 시각 (P0 합의: 만료 임박 배너용)
    exp: session.exp,
  });
});

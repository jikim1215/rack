import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertCanRead, assertAdmin } from "@/lib/authz";
import { FIXED_ACCESS_KEYS, isMenuKey, menuByKey } from "@/lib/menus";
import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { asBody, oneOf, flag, ValidationError } from "@/lib/validation/input";
import type { MenuPermissionRow } from "@/lib/db-types";

export const GET = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertCanRead(actor);

  // admin은 ?role= 파라미터로 다른 역할 조회 가능, 비admin은 자기 역할만
  let targetRole: string = actor.role;
  const queryRole = req.nextUrl.searchParams.get("role");
  if (queryRole && actor.role === "admin") {
    targetRole = queryRole;
  }

  const db = getDb();
  const rows = db.prepare("SELECT * FROM menu_permissions WHERE role = ?").all(targetRole) as MenuPermissionRow[];

  // 배열 형태로 반환 (SettingsView에서 순회 가능)
  const permissions = rows.map((r) => ({
    menu_key: r.menu_key,
    can_access: r.can_access,
    can_write: r.can_write,
    can_approve: r.can_approve,
  }));

  return NextResponse.json(permissions);
});

export const PUT = withApi(async (request: NextRequest) => {
  const actor = await getActor();
  assertAdmin(actor);

  const b = asBody(await readJson(request));
  const role = oneOf(b, "role", ["admin", "team", "viewer"] as const, { required: true, label: "역할" });
  if (!Array.isArray(b.permissions)) throw new ValidationError("permissions 형식이 올바르지 않습니다.");

  const permissions = (b.permissions as unknown[]).map((raw) => {
    const p = asBody(raw);
    const menu_key = String(p.menu_key ?? "");
    if (!isMenuKey(menu_key)) throw new ValidationError(`알 수 없는 메뉴 키입니다: ${menu_key}`);
    // 총괄 전용 메뉴는 역할로 고정 — 비관리자 역할에 행을 만들 수 없다 (서버도 무시하지만 저장 자체를 막아 혼란 방지)
    if (role !== "admin" && menuByKey(menu_key)?.adminOnly) throw new ValidationError(`'${menuByKey(menu_key)?.label}' 은(는) 총괄 전용 메뉴라 역할 권한을 저장할 수 없습니다.`);
    return {
      menu_key,
      can_access: flag(p, "can_access"),
      can_write: flag(p, "can_write"),
      can_approve: flag(p, "can_approve"),
    };
  });

  const db = getDb();

  // 감사로그용: 저장 전 해당 역할의 기존 권한을 menu_key → "a/w/ap" 맵으로 스냅샷.
  const beforeRows = db.prepare("SELECT * FROM menu_permissions WHERE role = ?").all(role) as MenuPermissionRow[];
  const oldMap: Record<string, string> = {};
  for (const r of beforeRows) oldMap[r.menu_key] = `${r.can_access}/${r.can_write}/${r.can_approve}`;

  const stmt = db.prepare(
    `INSERT INTO menu_permissions (menu_key, role, can_access, can_write, can_approve)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(menu_key, role) DO UPDATE SET
       can_access = excluded.can_access,
       can_write = excluded.can_write,
       can_approve = excluded.can_approve`
  );

  db.transaction((perms: typeof permissions) => {
    for (const p of perms) {
      const canAccess = FIXED_ACCESS_KEYS.includes(p.menu_key) ? 1 : p.can_access;
      stmt.run(p.menu_key, role, canAccess, p.can_write, p.can_approve);
    }
  })(permissions);

  const afterRows = db.prepare("SELECT * FROM menu_permissions WHERE role = ?").all(role) as MenuPermissionRow[];
  const newMap: Record<string, string> = {};
  for (const r of afterRows) newMap[r.menu_key] = `${r.can_access}/${r.can_write}/${r.can_approve}`;

  logAudit(db, {
    entityType: "permission",
    entityId: null,
    entityName: role,
    action: "update",
    changedBy: actor.username,
    oldData: oldMap,
    newData: newMap,
  });

  return NextResponse.json({ ok: true });
});

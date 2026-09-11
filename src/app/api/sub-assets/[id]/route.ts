import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuWrite, assertCanWrite, assertCanDelete, scopeWhere, type Actor } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { asBody, idOrNull, pathId, ValidationError } from "@/lib/validation/input";
import { parseSubAssetBody } from "@/lib/validation/subasset-input";
import type { SubAssetRow } from "@/lib/db-types";

type Ctx = { params: Promise<{ id: string }> };

/** 팀 스코프 안에서 대상 행을 찾는다. 스코프 밖 행은 존재 자체를 은폐(404)한다. */
function findScoped(db: ReturnType<typeof getDb>, actor: Actor, id: number): SubAssetRow | undefined {
  const scope = scopeWhere(actor, "s.team_id");
  return db.prepare(`
    SELECT s.* FROM sub_assets s WHERE s.id = ? AND ${scope.sql}
  `).get(id, ...scope.params) as SubAssetRow | undefined;
}

// 전체 교체(PUT) — 기존 행 없음/스코프 밖은 404 은폐, 변경 필드 diff 를 감사 로그에 남긴다.
export const PUT = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "subassets");
  const id = pathId((await params).id);
  const db = getDb();

  const existing = findScoped(db, actor, id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  assertCanWrite(actor, existing.team_id);

  const b = asBody(await readJson(req));
  const fields = parseSubAssetBody(b);

  // 부모 장비 유효성 검사 (POST 와 동일 규칙)
  const parentAssetId = idOrNull(b, "parent_asset_id", "부모 장비");
  if (parentAssetId != null) {
    const parent = db.prepare("SELECT id FROM assets WHERE id = ?").get(parentAssetId);
    if (!parent) throw new ValidationError("부모 장비를 찾을 수 없습니다.");
  }

  // 소유 팀 변경은 admin 만 가능. team 은 자기 팀 소유 유지.
  const nextTeamId = actor.role === "admin" && "team_id" in b ? idOrNull(b, "team_id", "소유 팀") : existing.team_id;

  db.prepare(`
    UPDATE sub_assets
    SET asset_code = @asset_code, category_major = @category_major, category_mid = @category_mid,
        category_minor = @category_minor, sub_name = @sub_name, spec = @spec,
        serial_number = @serial_number, acquired_date = @acquired_date, user_name = @user_name,
        place = @place, purpose = @purpose, note = @note, status = @status,
        parent_asset_id = @parent_asset_id, team_id = @team_id,
        updated_at = datetime('now','localtime')
    WHERE id = @id
  `).run({ ...fields, parent_asset_id: parentAssetId, team_id: nextTeamId, id: existing.id });

  logAudit(db, {
    entityType: "sub_asset",
    entityId: existing.id,
    entityName: fields.sub_name,
    action: "update",
    changedBy: actor.username,
    oldData: {
      asset_code: existing.asset_code, category_major: existing.category_major,
      category_mid: existing.category_mid, category_minor: existing.category_minor,
      sub_name: existing.sub_name, spec: existing.spec, serial_number: existing.serial_number,
      acquired_date: existing.acquired_date, user_name: existing.user_name, place: existing.place,
      purpose: existing.purpose, note: existing.note, status: existing.status,
      parent_asset_id: existing.parent_asset_id, team_id: existing.team_id,
    },
    newData: { ...fields, parent_asset_id: parentAssetId, team_id: nextTeamId },
  });

  const updated = db.prepare(`
    SELECT s.*, a.asset_name AS parent_name
    FROM sub_assets s
    LEFT JOIN assets a ON s.parent_asset_id = a.id
    WHERE s.id = ?
  `).get(existing.id) as SubAssetRow & { parent_name: string | null };
  return NextResponse.json(updated);
});

// 삭제 — 팀 스코프 밖 404 은폐, 삭제 스냅샷을 감사 로그에 남긴다.
export const DELETE = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "subassets");
  const id = pathId((await params).id);
  const db = getDb();

  const existing = findScoped(db, actor, id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  assertCanDelete(actor, existing.team_id);

  db.prepare("DELETE FROM sub_assets WHERE id = ?").run(existing.id);

  logAudit(db, {
    entityType: "sub_asset",
    entityId: existing.id,
    entityName: existing.sub_name,
    action: "delete",
    changedBy: actor.username,
    oldData: {
      asset_code: existing.asset_code, category_major: existing.category_major,
      category_mid: existing.category_mid, category_minor: existing.category_minor,
      sub_name: existing.sub_name, spec: existing.spec, serial_number: existing.serial_number,
      acquired_date: existing.acquired_date, user_name: existing.user_name, place: existing.place,
      purpose: existing.purpose, note: existing.note, status: existing.status,
      parent_asset_id: existing.parent_asset_id, team_id: existing.team_id,
    },
  });

  return NextResponse.json({ ok: true });
});

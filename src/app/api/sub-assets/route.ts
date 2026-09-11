import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, scopeWhere } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { asBody, idOrNull, ValidationError } from "@/lib/validation/input";
import { parseSubAssetBody } from "@/lib/validation/subasset-input";
import type { SubAssetRow } from "@/lib/db-types";

// 부속자산(sub_assets) — 자산(assets)과 동일한 팀 스코프 정책(ADR-007/009).
// admin/viewer 전체, team 은 자기 팀(s.team_id) 소유 행만.

// 목록 — 팀 스코프 + 부모 장비명(parent_name) JOIN 포함.
export const GET = withApi(async (_req: NextRequest) => {
  const actor = await getActor();
  assertMenuAccess(actor, "subassets");
  const db = getDb();
  const scope = scopeWhere(actor, "s.team_id");
  const rows = db.prepare(`
    SELECT s.*, a.asset_name AS parent_name
    FROM sub_assets s
    LEFT JOIN assets a ON s.parent_asset_id = a.id
    WHERE ${scope.sql}
    ORDER BY s.asset_code, s.id
  `).all(...scope.params) as (SubAssetRow & { parent_name: string | null })[];
  return NextResponse.json(rows);
});

// 생성 — team 은 자기 팀으로만, admin 은 team_id 지정/미지정 자유. viewer 불가.
export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "subassets");
  const b = asBody(await readJson(req));
  const ownerTeamId = actor.role === "team" ? actor.teamId : idOrNull(b, "team_id", "소유 팀");
  assertCanWrite(actor, ownerTeamId);

  const fields = parseSubAssetBody(b);
  const db = getDb();

  // 부모 장비 유효성 검사 — 존재하지 않는 assets.id 연결 금지 (FK SET NULL 이지만 입력 시점에 차단).
  const parentAssetId = idOrNull(b, "parent_asset_id", "부모 장비");
  if (parentAssetId != null) {
    const parent = db.prepare("SELECT id FROM assets WHERE id = ?").get(parentAssetId);
    if (!parent) throw new ValidationError("부모 장비를 찾을 수 없습니다.");
  }

  const result = db.prepare(`
    INSERT INTO sub_assets (asset_code, category_major, category_mid, category_minor, sub_name,
      spec, serial_number, acquired_date, user_name, place, purpose, note, status,
      parent_asset_id, team_id)
    VALUES (@asset_code, @category_major, @category_mid, @category_minor, @sub_name,
      @spec, @serial_number, @acquired_date, @user_name, @place, @purpose, @note, @status,
      @parent_asset_id, @team_id)
  `).run({ ...fields, parent_asset_id: parentAssetId, team_id: ownerTeamId });

  const subAssetId = Number(result.lastInsertRowid);
  logAudit(db, {
    entityType: "sub_asset",
    entityId: subAssetId,
    entityName: fields.sub_name,
    action: "create",
    changedBy: actor.username,
    newData: { ...fields, parent_asset_id: parentAssetId, team_id: ownerTeamId },
  });

  const created = db.prepare(`
    SELECT s.*, a.asset_name AS parent_name
    FROM sub_assets s
    LEFT JOIN assets a ON s.parent_asset_id = a.id
    WHERE s.id = ?
  `).get(subAssetId) as SubAssetRow & { parent_name: string | null };
  return NextResponse.json(created, { status: 201 });
});

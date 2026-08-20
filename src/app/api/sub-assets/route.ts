import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, assertCanWrite, scopeWhere } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

// 부속자산(sub_assets) — 자산(assets)과 동일한 팀 스코프 정책(ADR-007/009).
// admin/viewer 전체, team 은 자기 팀(s.team_id) 소유 행만.

/** 요청 본문에서 부속자산 업무 필드를 정규화한다 (status 는 active/disposed 화이트리스트). */
function parseSubAssetBody(body: Record<string, unknown>) {
  const s = (v: unknown) => String(v ?? "").trim();
  return {
    asset_code: s(body.asset_code),
    category_major: s(body.category_major),
    category_mid: s(body.category_mid),
    category_minor: s(body.category_minor),
    sub_name: s(body.sub_name),
    spec: s(body.spec),
    serial_number: s(body.serial_number),
    acquired_date: s(body.acquired_date),
    user_name: s(body.user_name),
    place: s(body.place),
    purpose: s(body.purpose),
    note: s(body.note),
    status: body.status === "disposed" ? "disposed" : "active",
  };
}

// 목록 — 팀 스코프 + 부모 장비명(parent_name) JOIN 포함.
export async function GET() {
  const actor = await getActor();
  try {
    assertCanRead(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }
  const db = getDb();
  const scope = scopeWhere(actor, "s.team_id");
  const rows = db.prepare(`
    SELECT s.*, a.asset_name AS parent_name
    FROM sub_assets s
    LEFT JOIN assets a ON s.parent_asset_id = a.id
    WHERE ${scope.sql}
    ORDER BY s.asset_code, s.id
  `).all(...scope.params);
  return NextResponse.json(rows);
}

// 생성 — team 은 자기 팀으로만, admin 은 team_id 지정/미지정 자유. viewer 불가.
export async function POST(req: NextRequest) {
  const actor = await getActor();
  const body = await req.json();
  const ownerTeamId =
    actor?.role === "team"
      ? actor.teamId
      : body.team_id === "" || body.team_id == null
        ? null
        : Number(body.team_id);
  try {
    assertCanWrite(actor, ownerTeamId);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const fields = parseSubAssetBody(body);
  if (!fields.sub_name) {
    return NextResponse.json({ error: "자산명을 입력하세요." }, { status: 400 });
  }

  const db = getDb();

  // 부모 장비 유효성 검사 — 존재하지 않는 assets.id 연결 금지 (FK SET NULL 이지만 입력 시점에 차단).
  let parentAssetId: number | null = null;
  if (body.parent_asset_id != null && body.parent_asset_id !== "") {
    const pid = Number(body.parent_asset_id);
    if (!Number.isInteger(pid) || pid <= 0) {
      return NextResponse.json({ error: "부모 장비 지정이 올바르지 않습니다." }, { status: 400 });
    }
    const parent = db.prepare("SELECT id FROM assets WHERE id = ?").get(pid);
    if (!parent) {
      return NextResponse.json({ error: "부모 장비를 찾을 수 없습니다." }, { status: 400 });
    }
    parentAssetId = pid;
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
    changedBy: actor?.username || "system",
    newData: { ...fields, parent_asset_id: parentAssetId, team_id: ownerTeamId },
  });

  const created = db.prepare(`
    SELECT s.*, a.asset_name AS parent_name
    FROM sub_assets s
    LEFT JOIN assets a ON s.parent_asset_id = a.id
    WHERE s.id = ?
  `).get(subAssetId);
  return NextResponse.json(created, { status: 201 });
}

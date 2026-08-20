import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanWrite, assertCanDelete, scopeWhere } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

interface SubAssetRow {
  id: number;
  asset_code: string;
  category_major: string;
  category_mid: string;
  category_minor: string;
  sub_name: string;
  spec: string;
  serial_number: string;
  acquired_date: string;
  user_name: string;
  place: string;
  purpose: string;
  note: string;
  status: "active" | "disposed";
  parent_asset_id: number | null;
  team_id: number | null;
  created_at: string;
  updated_at: string;
}

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

/** 팀 스코프 안에서 대상 행을 찾는다. 스코프 밖 행은 존재 자체를 은폐(404)한다. */
function findScoped(db: ReturnType<typeof getDb>, actor: Awaited<ReturnType<typeof getActor>>, id: number): SubAssetRow | undefined {
  const scope = scopeWhere(actor, "s.team_id");
  return db.prepare(`
    SELECT s.* FROM sub_assets s WHERE s.id = ? AND ${scope.sql}
  `).get(id, ...scope.params) as SubAssetRow | undefined;
}

// 전체 교체(PUT) — 기존 행 없음/스코프 밖은 404 은폐, 변경 필드 diff 를 감사 로그에 남긴다.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const db = getDb();

  const existing = findScoped(db, actor, Number(id));
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    assertCanWrite(actor, existing.team_id);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const body = await req.json();
  const fields = parseSubAssetBody(body);
  if (!fields.sub_name) {
    return NextResponse.json({ error: "자산명을 입력하세요." }, { status: 400 });
  }

  // 부모 장비 유효성 검사 (POST 와 동일 규칙)
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

  // 소유 팀 변경은 admin 만 가능. team 은 자기 팀 소유 유지.
  const nextTeamId =
    actor?.role === "admin" && body.team_id !== undefined
      ? body.team_id === "" || body.team_id == null
        ? null
        : Number(body.team_id)
      : existing.team_id;

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
    changedBy: actor?.username || "system",
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
  `).get(existing.id);
  return NextResponse.json(updated);
}

// 삭제 — 팀 스코프 밖 404 은폐, 삭제 스냅샷을 감사 로그에 남긴다.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const db = getDb();

  const existing = findScoped(db, actor, Number(id));
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    assertCanDelete(actor, existing.team_id);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  db.prepare("DELETE FROM sub_assets WHERE id = ?").run(existing.id);

  logAudit(db, {
    entityType: "sub_asset",
    entityId: existing.id,
    entityName: existing.sub_name,
    action: "delete",
    changedBy: actor?.username || "system",
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
}

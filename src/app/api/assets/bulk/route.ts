import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { logAssetChange } from "@/lib/audit";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanWrite, assertCanDelete, scopeWhere } from "@/lib/authz";

// 검색/선택한 자산 일괄수정 — 허용 필드(망구분·상태·관리자·사용자·보안등급 C/I/A·관리부서 team_id)만 변경.
// 관리부서(소유 팀) 재지정은 admin 전용(스코프 이탈 방지). 나머지는 team 계정도 자기 팀 범위 내 가능.
// 서버측 행수준 인가(ADR-007): team 계정은 자기 팀 소유 자산만 수정(scopeWhere),
// viewer/미인증은 거부(assertCanWrite). 실제 값이 바뀐 각 건을 감사로그(update)에 기록한다.

// 상태는 운영 enum(고정). 망구분은 ADR-011 확장으로 자유 입력(독립 부서 자체 망 명칭 허용) — 길이만 제한.
const STATUSES = new Set(["active", "maintenance", "standby", "retired"]);
const ZONE_MAXLEN = 30;

export async function PATCH(req: NextRequest) {
  const actor = await getActor();
  try {
    assertCanWrite(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const body = await req.json().catch(() => null);
  const rawIds = Array.isArray(body?.asset_ids) ? body.asset_ids : [];
  const assetIds = Array.from(
    new Set(
      rawIds.map((v: unknown) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0),
    ),
  ) as number[];
  if (assetIds.length === 0) {
    return NextResponse.json({ error: "수정할 자산을 선택하세요." }, { status: 400 });
  }

  // 허용 필드만 화이트리스트 + 값 검증
  //  - 망구분/상태: enum  · 관리자/사용자: 텍스트(≤100자)  · 보안등급 C·I·A: 1~3 또는 미지정(null)
  const patch = body?.patch && typeof body.patch === "object" ? body.patch : {};
  const setCols: { col: string; val: string | number | null }[] = [];
  if ("network_zone" in patch) {
    const v = String(patch.network_zone ?? "").trim();
    if (v.length > ZONE_MAXLEN) return NextResponse.json({ error: `망구분은 최대 ${ZONE_MAXLEN}자입니다.` }, { status: 400 });
    setCols.push({ col: "network_zone", val: v });
  }
  if ("status" in patch) {
    const v = String(patch.status ?? "");
    if (!STATUSES.has(v)) return NextResponse.json({ error: "상태 값이 올바르지 않습니다." }, { status: 400 });
    setCols.push({ col: "status", val: v });
  }
  for (const col of ["admin_name", "user_name"] as const) {
    if (col in patch) {
      const v = String(patch[col] ?? "");
      if (v.length > 100) return NextResponse.json({ error: "값이 너무 깁니다(최대 100자)." }, { status: 400 });
      setCols.push({ col, val: v });
    }
  }
  for (const col of ["cia_c", "cia_i", "cia_a"] as const) {
    if (col in patch) {
      const raw = patch[col];
      if (raw === "" || raw == null) {
        setCols.push({ col, val: null });
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > 3) {
          return NextResponse.json({ error: "보안등급은 1~3 사이의 값이어야 합니다." }, { status: 400 });
        }
        setCols.push({ col, val: n });
      }
    }
  }
  // 관리부서(소유 팀) 재지정 — team_id. ADR-009: 소유 권위는 team_id. admin만 변경 가능(단건 PUT과 동일 정책).
  // team 계정이 자기 팀 자산을 타 팀으로 넘기면 스코프 이탈이므로 서버에서 admin-only로 강제 차단한다.
  if ("team_id" in patch) {
    if (actor!.role !== "admin") {
      return NextResponse.json({ error: "관리부서(소유 팀) 변경은 관리자만 가능합니다." }, { status: 403 });
    }
    const raw = patch.team_id;
    if (raw === "" || raw == null) {
      setCols.push({ col: "team_id", val: null }); // 미지정(소유 팀 해제)
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json({ error: "관리부서 값이 올바르지 않습니다." }, { status: 400 });
      }
      const exists = getDb().prepare("SELECT 1 FROM teams WHERE id = ?").get(n);
      if (!exists) {
        return NextResponse.json({ error: "존재하지 않는 관리부서(팀)입니다." }, { status: 400 });
      }
      setCols.push({ col: "team_id", val: n });
    }
  }
  if (setCols.length === 0) {
    return NextResponse.json({ error: "변경할 항목을 선택하세요." }, { status: 400 });
  }

  const db = getDb();
  // 행수준 범위 제한: admin 전체, team 자기 팀 소유만. 범위 밖 id는 조회되지 않아 건너뛴다.
  const scope = scopeWhere(actor);
  const placeholders = assetIds.map(() => "?").join(",");
  // 변경 대상 컬럼의 기존값도 함께 조회(변경 여부 비교·감사 기록용). col 은 위 화이트리스트 상수만.
  const cols = setCols.map((c) => c.col);
  const selectCols = ["id", "asset_name", ...cols].join(", ");
  const targets = db
    .prepare(`SELECT ${selectCols} FROM assets WHERE id IN (${placeholders}) AND ${scope.sql}`)
    .all(...assetIds, ...scope.params) as Array<Record<string, any>>;

  const newVals: Record<string, string | number | null> = {};
  for (const c of setCols) newVals[c.col] = c.val;
  const setSql = setCols.map((c) => `${c.col}=@${c.col}`).join(", ");
  const upd = db.prepare(
    `UPDATE assets SET ${setSql}, updated_at=datetime('now','localtime') WHERE id=@id`,
  );

  let updated = 0;
  const tx = db.transaction(() => {
    for (const old of targets) {
      // 실제 변경이 있는 건만 반영(감사 노이즈 방지)
      const changed = setCols.some((c) => String(old[c.col] ?? "") !== String(c.val ?? ""));
      if (!changed) continue;
      upd.run({ id: old.id, ...newVals });
      logAssetChange(db, {
        assetId: old.id,
        assetName: old.asset_name,
        action: "update",
        changedBy: actor!.username,
        oldData: Object.fromEntries(setCols.map((c) => [c.col, old[c.col]])),
        newData: newVals,
      });
      updated++;
    }
  });
  tx();

  return NextResponse.json({
    ok: true,
    updated,
    skipped: assetIds.length - updated,
    patch: newVals,
  });
}

// 검색/선택한 자산 일괄삭제 — 단건 삭제(DELETE /api/assets/[id])와 동일 정책.
// 행수준 인가(ADR-007): team 계정은 자기 팀 소유 자산만(scopeWhere), viewer/미인증 거부(assertCanDelete).
// 범위 밖 id는 조회되지 않아 건너뛴다. 삭제된 각 건을 감사로그(delete)에 기록한다.
export async function DELETE(req: NextRequest) {
  const actor = await getActor();
  try {
    assertCanDelete(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const body = await req.json().catch(() => null);
  const rawIds = Array.isArray(body?.asset_ids) ? body.asset_ids : [];
  const assetIds = Array.from(
    new Set(
      rawIds.map((v: unknown) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0),
    ),
  ) as number[];
  if (assetIds.length === 0) {
    return NextResponse.json({ error: "삭제할 자산을 선택하세요." }, { status: 400 });
  }

  const db = getDb();
  const scope = scopeWhere(actor);
  const placeholders = assetIds.map(() => "?").join(",");
  // 권한 범위 내 대상만 조회(감사 oldData 보존용 전체 행). 범위 밖 id는 자동 제외.
  const targets = db
    .prepare(`SELECT * FROM assets WHERE id IN (${placeholders}) AND ${scope.sql}`)
    .all(...assetIds, ...scope.params) as Array<Record<string, any>>;

  const del = db.prepare("DELETE FROM assets WHERE id = ?");
  let deleted = 0;
  const tx = db.transaction(() => {
    for (const old of targets) {
      del.run(old.id);
      logAssetChange(db, {
        assetId: old.id,
        assetName: old.asset_name || "",
        action: "delete",
        changedBy: actor!.username,
        oldData: old,
      });
      deleted++;
    }
  });
  tx();

  return NextResponse.json({
    ok: true,
    deleted,
    skipped: assetIds.length - deleted,
  });
}

import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanWrite } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { isXlsxBuffer } from "@/lib/validation/asset-rules";
import { parseSubAssetWorkbook, SUBASSET_INSERT_COLUMNS } from "@/lib/subasset-import";

// 부속자산 일괄 업로드 — 대량 가져오기는 쓰기 작업(viewer 차단).
//   team 계정: 자기 팀으로 강제 귀속. admin: '관리부서' 열의 팀명으로 find-or-create.
//   '상위장비' 열은 자산명으로 assets 매칭 → parent_asset_id 연결(데이터 연계). 미존재 시 null.
export async function POST(req: NextRequest) {
  const actor = await getActor();
  try {
    assertCanWrite(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }

  const actorName = actor?.username || "system";
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!isXlsxBuffer(buffer)) {
    return NextResponse.json({ error: "유효한 .xlsx 파일이 아닙니다 (매직바이트 불일치)." }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseSubAssetWorkbook(buffer);
  } catch {
    return NextResponse.json({ error: "엑셀 파싱에 실패했습니다." }, { status: 400 });
  }
  const { subs, skipped } = parsed;
  if (subs.length === 0) {
    return NextResponse.json({ error: "가져올 유효한 행이 없습니다.", skipped }, { status: 400 });
  }

  const db = getDb();

  // 팀 해석(관리부서명 → team_id). team 계정은 자기 팀 강제라 이 맵을 쓰지 않는다.
  const teamByName = new Map<string, number>(
    (db.prepare("SELECT id, team_name FROM teams").all() as { id: number; team_name: string }[])
      .map((t) => [String(t.team_name).trim(), t.id]),
  );
  const insertTeam = db.prepare("INSERT INTO teams (team_name) VALUES (?)");
  let teamsCreated = 0;
  function resolveTeamId(name: string): number | null {
    const n = name.trim();
    if (!n) return null;
    const hit = teamByName.get(n);
    if (hit !== undefined) return hit;
    const id = Number(insertTeam.run(n).lastInsertRowid);
    teamByName.set(n, id);
    teamsCreated++;
    return id;
  }

  // 상위장비명 → assets.id (동명 다수면 최소 id, 없으면 null)
  const findParent = db.prepare("SELECT id FROM assets WHERE asset_name = ? ORDER BY id LIMIT 1");

  const cols = [...SUBASSET_INSERT_COLUMNS, "parent_asset_id", "team_id"];
  const insert = db.prepare(`
    INSERT INTO sub_assets (${cols.join(", ")})
    VALUES (${cols.map((c) => `@${c}`).join(", ")})
  `);

  let inserted = 0;
  const tx = db.transaction(() => {
    for (const s of subs) {
      const team_id = actor?.role === "team" ? (actor.teamId ?? null) : resolveTeamId(s.team_name);
      const parent = s.parent_name
        ? (findParent.get(s.parent_name) as { id: number } | undefined)
        : undefined;
      const row: Record<string, unknown> = {};
      for (const c of SUBASSET_INSERT_COLUMNS) row[c] = s[c];
      insert.run({ ...row, parent_asset_id: parent ? parent.id : null, team_id });
      inserted++;
    }
  });
  tx();

  logAudit(db, {
    entityType: "sub_asset",
    entityId: null,
    entityName: "부속자산 가져오기",
    action: "create",
    changedBy: actorName,
    newData: { event: "subasset_import", inserted, skipped, teamsCreated },
  });

  return NextResponse.json({ ok: true, inserted, skipped, teamsCreated });
}

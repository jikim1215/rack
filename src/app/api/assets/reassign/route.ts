import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertAdmin } from "@/lib/authz";
import { reassignUnassignedAssets } from "@/lib/asset-reassign";
import { asBody, ValidationError } from "@/lib/validation/input";
import type { TeamRow } from "@/lib/db-types";

// 미배정 자산 재배정 (AC-11) — 총괄(admin) 전용. scope=unassigned: 현재 team_id가 NULL인 자산만
// 대상 팀으로 일괄/개별 배정한다(이미 배정된 자산은 탈취 불가). 각 건을 감사로그(update)에 기록.
export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertAdmin(actor);

  const body = asBody(await readJson(req));
  const rawIds = Array.isArray(body.asset_ids) ? body.asset_ids : [];
  const assetIds = Array.from(
    new Set(
      rawIds.map((v: unknown) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0),
    ),
  ) as number[];
  if (assetIds.length === 0) {
    throw new ValidationError("재배정할 자산을 선택하세요.");
  }

  const teamId = body.team_id === "" || body.team_id == null ? null : Number(body.team_id);
  if (teamId == null || !Number.isInteger(teamId) || teamId <= 0) {
    throw new ValidationError("배정할 팀을 선택하세요.");
  }

  const db = getDb();
  const team = db.prepare("SELECT id, team_name FROM teams WHERE id = ?").get(teamId) as
    | Pick<TeamRow, "id" | "team_name">
    | undefined;
  if (!team) {
    throw new ValidationError("존재하지 않는 팀입니다.");
  }

  const result = reassignUnassignedAssets(db, { assetIds, teamId, actorUsername: actor.username });

  if (result.reassigned === 0) {
    return NextResponse.json(
      { error: "재배정 가능한 미배정 자산이 없습니다 (이미 배정되었거나 존재하지 않음).", skipped: result.skipped },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    reassigned: result.reassigned,
    skipped: result.skipped,
    team_id: teamId,
    team_name: team.team_name,
  });
});

import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertAdmin } from "@/lib/authz";
import { reassignUnassignedAssets } from "@/lib/asset-reassign";
import { asBody, ValidationError } from "@/lib/validation/input";
import type { TeamRow } from "@/lib/db-types";

interface DeptPayloadItem {
  department: string;
  team_id: number;
}

// 미배정 자산 재배정 (AC-11) — 총괄(admin) 전용. scope=unassigned: 현재 team_id가 NULL인 자산만
// 대상 팀으로 일괄/개별 배정한다(이미 배정된 자산은 탈취 불가). 각 건을 감사로그(update)에 기록.
export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertAdmin(actor);

  const body = asBody(await readJson(req));
  const db = getDb();

  // 1. 신규 모드: 부서별 일괄 배정 ({ by_department: [{ department, team_id }] })
  if (Array.isArray(body.by_department)) {
    const rawDepts = body.by_department as unknown[];
    const deptEntries: DeptPayloadItem[] = rawDepts
      .map((item) => {
        const obj = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        return {
          department: String(obj.department ?? "").trim(),
          team_id: Number(obj.team_id),
        };
      })
      .filter((item) => Number.isInteger(item.team_id) && item.team_id > 0);

    if (deptEntries.length === 0) {
      throw new ValidationError("배정할 부서와 팀 목록이 유효하지 않습니다.");
    }

    const teamIds = Array.from(new Set(deptEntries.map((e) => e.team_id)));
    const ph = teamIds.map(() => "?").join(",");
    const teamsList = db
      .prepare(`SELECT id, team_name FROM teams WHERE id IN (${ph})`)
      .all(...teamIds) as Pick<TeamRow, "id" | "team_name">[];

    const teamsMap = new Map<number, string>(teamsList.map((t) => [t.id, t.team_name]));

    for (const entry of deptEntries) {
      if (!teamsMap.has(entry.team_id)) {
        throw new ValidationError(`존재하지 않는 팀입니다 (ID: ${entry.team_id}).`);
      }
    }

    let totalReassigned = 0;
    const byDepartmentResult: { department: string; team_name: string; count: number }[] = [];

    const tx = db.transaction(() => {
      for (const entry of deptEntries) {
        const deptName = entry.department;
        const teamId = entry.team_id;
        const teamName = teamsMap.get(teamId) ?? "";

        const assets =
          deptName === ""
            ? (db
                .prepare(
                  `SELECT id FROM assets WHERE team_id IS NULL AND (department = '' OR department IS NULL)`,
                )
                .all() as { id: number }[])
            : (db
                .prepare(`SELECT id FROM assets WHERE team_id IS NULL AND department = ?`)
                .all(deptName) as { id: number }[]);

        const assetIds = assets.map((a) => a.id);
        if (assetIds.length === 0) {
          byDepartmentResult.push({ department: deptName, team_name: teamName, count: 0 });
          continue;
        }

        const res = reassignUnassignedAssets(db, {
          assetIds,
          teamId,
          actorUsername: actor.username,
        });

        totalReassigned += res.reassigned;
        byDepartmentResult.push({
          department: deptName,
          team_name: teamName,
          count: res.reassigned,
        });
      }
    });

    tx();

    return NextResponse.json({
      ok: true,
      reassigned: totalReassigned,
      byDepartment: byDepartmentResult,
    });
  }

  // 2. 기존 모드: 자산 ID 목록 개별/선택 일괄 배정 ({ asset_ids, team_id })
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

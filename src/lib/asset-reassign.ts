// 미배정(team_id NULL) 자산 재배정 핵심 로직 (AC-11). 순수 모듈(프레임워크 import 없음)이라
// 라우트와 테스트가 동일 코드를 공유한다(단일 진실원천). scope=unassigned 불변식을 SQL에서 강제:
// 이미 배정된 자산은 절대 재배정/탈취되지 않는다.
import type Database from "better-sqlite3";

export interface ReassignResult {
  reassigned: number;
  skipped: number;
  reassignedIds: number[];
}

/**
 * 주어진 자산 중 현재 미배정(team_id IS NULL)인 것만 teamId로 배정하고 각 건을 감사로그(update)에
 * 기록한다. 단일 트랜잭션. 호출자는 teamId 유효성(팀 존재)을 사전 검증해야 한다.
 */
export function reassignUnassignedAssets(
  db: Database.Database,
  input: { assetIds: number[]; teamId: number; actorUsername: string },
): ReassignResult {
  const { assetIds, teamId, actorUsername } = input;
  if (assetIds.length === 0) return { reassigned: 0, skipped: 0, reassignedIds: [] };
  const ph = assetIds.map(() => "?").join(",");
  // scope=unassigned: team_id IS NULL 인 대상만 선택
  const targets = db
    .prepare(`SELECT id, asset_name FROM assets WHERE id IN (${ph}) AND team_id IS NULL`)
    .all(...assetIds) as { id: number; asset_name: string }[];

  const update = db.prepare("UPDATE assets SET team_id = ? WHERE id = ? AND team_id IS NULL");
  const auditInsert = db.prepare(
    `INSERT INTO audit_logs (entity_type, entity_id, entity_name, action, changed_by, changed_fields, old_values, new_values)
     VALUES ('asset', ?, ?, 'update', ?, ?, ?, ?)`,
  );
  const reassignedIds: number[] = [];
  const tx = db.transaction(() => {
    for (const t of targets) {
      const info = update.run(teamId, t.id);
      if (info.changes === 1) {
        reassignedIds.push(t.id);
        auditInsert.run(
          t.id,
          t.asset_name,
          actorUsername,
          JSON.stringify(["team_id"]),
          JSON.stringify({ team_id: null }),
          JSON.stringify({ team_id: teamId }),
        );
      }
    }
  });
  tx();

  return {
    reassigned: reassignedIds.length,
    skipped: assetIds.length - reassignedIds.length,
    reassignedIds,
  };
}

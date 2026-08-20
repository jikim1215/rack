// 임포트 배치 롤백 핵심 로직 — API 라우트에서 분리해 단위테스트 가능하게 유지.
// 설계 근거: 임포트는 INSERT 전용이므로 배치의 영향 = 신규 생성분뿐 → 생성분 삭제 = 완전 복구.
// (외부 검토 R6-1 합의, 사전 집계는 2차 R1-3 합의)
import type Database from "better-sqlite3";
import { logAssetChange } from "./audit.ts";

export interface RollbackPreview {
  total: number;      // 배치 생성 자산 수
  modified: number;   // 임포트 후 수정된 자산 수 (updated_at ≠ created_at)
  linked: number;     // 계약/추가IP/실사체크/부속 연결을 보유한 자산 수 (중복 제거)
  open_issues: number; // 해당 배치의 미조치 정리큐 이슈 수
}

/** 배치 삭제 예상량 분해. 대상 없으면 null. */
export function rollbackPreview(db: Database.Database, batchId: string): RollbackPreview | null {
  const targets = db.prepare("SELECT id, created_at, updated_at FROM assets WHERE import_batch_id = ?").all(batchId) as any[];
  if (targets.length === 0) return null;

  const ids = targets.map((a) => a.id);
  const ph = ids.map(() => "?").join(",");
  const modified = targets.filter((a) => a.updated_at && a.updated_at !== a.created_at).length;
  const linked = new Set(
    [
      ...(db.prepare(`SELECT asset_id AS id FROM contract_assets WHERE asset_id IN (${ph})`).all(...ids) as any[]),
      ...(db.prepare(`SELECT asset_id AS id FROM asset_ips WHERE asset_id IN (${ph})`).all(...ids) as any[]),
      ...(db.prepare(`SELECT asset_id AS id FROM inventory_audit_checks WHERE asset_id IN (${ph})`).all(...ids) as any[]),
      ...(db.prepare(`SELECT parent_asset_id AS id FROM sub_assets WHERE parent_asset_id IN (${ph})`).all(...ids) as any[]),
    ].map((r: any) => r.id),
  ).size;
  const open_issues = (db.prepare("SELECT COUNT(*) AS c FROM import_issue WHERE batch_id = ? AND status = 'open'").get(batchId) as { c: number }).c;

  return { total: targets.length, modified, linked, open_issues };
}

/**
 * 배치 생성 자산 전량 삭제 + 자산별 delete 감사 + 배치 open 이슈 자동 'ignored' 정리.
 * 전체가 단일 트랜잭션 — 부분 실패 상태가 존재하지 않는다.
 * @returns 삭제 건수 (대상 없으면 0, 쓰기 없음)
 */
export function rollbackBatch(db: Database.Database, batchId: string, actorName: string): number {
  const targets = db.prepare("SELECT * FROM assets WHERE import_batch_id = ?").all(batchId) as any[];
  if (targets.length === 0) return 0;

  db.transaction(() => {
    const del = db.prepare("DELETE FROM assets WHERE id = ?");
    for (const a of targets) {
      del.run(a.id);
      logAssetChange(db, {
        assetId: a.id,
        assetName: a.asset_name,
        action: "delete",
        changedBy: actorName,
        oldData: {
          asset_type: a.asset_type, asset_name: a.asset_name, serial_number: a.serial_number,
          ip_address: a.ip_address, rack_id: a.rack_id, team_id: a.team_id,
          import_batch_id: a.import_batch_id, _cause: `임포트 배치 롤백(${batchId})`,
        },
      });
    }
    // 배치 정합성 (외부 검토 2차 R1-4 합의): 삭제된 자산을 전제로 한 미조치 이슈가 큐에 남지 않게
    db.prepare(`
      UPDATE import_issue
      SET status = 'ignored', resolved_by = ?, resolved_at = datetime('now','localtime'),
          note = note || ' [배치 롤백으로 자동 무시]'
      WHERE batch_id = ? AND status = 'open'
    `).run(actorName, batchId);
  })();

  return targets.length;
}

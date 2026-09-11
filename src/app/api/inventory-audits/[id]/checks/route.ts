import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, scopeWhere } from "@/lib/authz";
import { asBody, oneOf, idOrNull, str, pathId, ValidationError } from "@/lib/validation/input";
import type { InventoryAuditRow, InventoryAuditCheckRow, AssetRow, SubAssetRow } from "@/lib/db-types";

type Ctx = { params: Promise<{ id: string }> };

// 회차의 대상별 확인 현황 — 스코프 내 장비(assets) 전체 + 부속자산(sub_assets, 폐기 제외)을
// UNION ALL 로 합쳐 확인 기록을 LEFT JOIN. (미확인 대상도 행으로 나와야 전수 실사 화면이 성립한다.)
// 행 모양: { kind: 'asset'|'sub', target_id, name, type_or_category, location, serial_number, code, ... }
//  - 장비: type_or_category = 유형 한글 라벨, location = 랙명, code = 관리번호(asset_tag)
//  - 부속: type_or_category = 중분류 > 소분류, location = 설치장소(place), code = 자산코드(asset_code)
export const GET = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuAccess(actor, "inspection");
  const id = pathId((await params).id);
  const db = getDb();

  const audit = db.prepare("SELECT * FROM inventory_audits WHERE id = ?").get(id) as InventoryAuditRow | undefined;
  if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const scope = scopeWhere(actor, "a.team_id");
  const subScope = scopeWhere(actor, "s.team_id");
  const rows = db.prepare(`
    SELECT 'asset' AS kind, a.id AS target_id, a.asset_type,
           a.asset_name AS name,
           CASE a.asset_type
             WHEN 'server' THEN '서버' WHEN 'network' THEN '네트워크'
             WHEN 'security' THEN '정보보호' WHEN 'telecom' THEN '전화설비'
             WHEN 'vm' THEN '가상머신' ELSE '기타' END AS type_or_category,
           r.rack_name AS location, a.serial_number, a.asset_tag AS code,
           c.id AS check_id, c.result, c.note, c.checked_by, c.checked_at
    FROM assets a
    LEFT JOIN racks r ON a.rack_id = r.id
    LEFT JOIN inventory_audit_checks c ON c.asset_id = a.id AND c.audit_id = ?
    WHERE ${scope.sql}
    UNION ALL
    SELECT 'sub' AS kind, s.id AS target_id, NULL AS asset_type,
           s.sub_name AS name,
           TRIM(COALESCE(s.category_mid, '') ||
             CASE WHEN COALESCE(s.category_minor, '') != '' THEN ' > ' || s.category_minor ELSE '' END) AS type_or_category,
           s.place AS location, s.serial_number, s.asset_code AS code,
           c.id AS check_id, c.result, c.note, c.checked_by, c.checked_at
    FROM sub_assets s
    LEFT JOIN inventory_audit_checks c ON c.sub_asset_id = s.id AND c.audit_id = ?
    WHERE s.status != 'disposed' AND ${subScope.sql}
    ORDER BY kind, name, target_id -- 결정적 정렬 (비평 합의 R3-4)
  `).all(id, ...scope.params, id, ...subScope.params);

  return NextResponse.json({ audit, rows });
});

// 확인 기록 upsert — {kind: 'asset'|'sub', target_id, result, note}. 회차당 대상 1행(UNIQUE) 갱신.
// 하위호환: kind 없이 {asset_id, ...} 바디도 장비 기록으로 처리한다.
export const POST = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "inspection");
  const id = pathId((await params).id);
  const b = asBody(await readJson(req));
  const db = getDb();

  const audit = db.prepare("SELECT * FROM inventory_audits WHERE id = ?").get(id) as InventoryAuditRow | undefined;
  if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // kind 없이 asset_id만 오면 하위호환으로 장비 기록 처리.
  const kind = b.kind == null && b.asset_id != null ? "asset" : oneOf(b, "kind", ["asset", "sub"] as const, { label: "대상 종류" });
  const targetIdRaw = b.target_id ?? b.asset_id;
  const targetId = idOrNull({ target_id: targetIdRaw }, "target_id", "대상 ID");
  if (targetId == null) throw new ValidationError("대상 ID가 올바르지 않습니다.");
  const result = oneOf(b, "result", ["confirmed", "missing", "moved", "disposed"] as const, { label: "실사 결과" });
  const note = str(b, "note", { max: 1000, label: "비고" });

  // kind 별 대상 검증 — team 계정에는 타 팀 대상의 존재 자체를 숨긴다(404 패턴, 목록 스코프와 일관).
  // 부속자산은 폐기(disposed) 행이 실사 대상 목록에 없으므로 동일하게 404 처리한다.
  const target = kind === "asset"
    ? db.prepare("SELECT id, team_id FROM assets WHERE id = ?").get(targetId) as Pick<AssetRow, "id" | "team_id"> | undefined
    : db.prepare("SELECT id, team_id FROM sub_assets WHERE id = ? AND status != 'disposed'").get(targetId) as Pick<SubAssetRow, "id" | "team_id"> | undefined;
  if (!target || (actor.role === "team" && target.team_id !== actor.teamId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  assertCanWrite(actor, target.team_id);

  if (audit.status !== "open") {
    return NextResponse.json({ error: "마감된 회차에는 기록할 수 없습니다." }, { status: 409 });
  }

  if (kind === "asset") {
    db.prepare(`
      INSERT INTO inventory_audit_checks (audit_id, asset_id, result, note, checked_by, checked_at)
      VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(audit_id, asset_id) DO UPDATE SET
        result = excluded.result,
        note = excluded.note,
        checked_by = excluded.checked_by,
        checked_at = excluded.checked_at
    `).run(audit.id, targetId, result, note, actor.username);
  } else {
    db.prepare(`
      INSERT INTO inventory_audit_checks (audit_id, sub_asset_id, result, note, checked_by, checked_at)
      VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(audit_id, sub_asset_id) DO UPDATE SET
        result = excluded.result,
        note = excluded.note,
        checked_by = excluded.checked_by,
        checked_at = excluded.checked_at
    `).run(audit.id, targetId, result, note, actor.username);
  }

  const check = db.prepare(
    kind === "asset"
      ? "SELECT * FROM inventory_audit_checks WHERE audit_id = ? AND asset_id = ?"
      : "SELECT * FROM inventory_audit_checks WHERE audit_id = ? AND sub_asset_id = ?"
  ).get(audit.id, targetId) as InventoryAuditCheckRow;
  return NextResponse.json(check, { status: 201 });
});

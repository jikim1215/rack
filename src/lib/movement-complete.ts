import type Database from "better-sqlite3";
import type { MovementRow } from "./db-types";
import { logAssetChange } from "./audit.ts";

// 반입 완료 + 자산 미연결(직접입력) → 자산 대장 자동 등록.
//   신청자가 기재한 물리정보(품목/제조사/모델/크기/시리얼)를 그대로 대장에 매핑 = 데이터 연계.
//   소유(관리부서)는 assets.team_id 단일 정본(ADR-009) — 신청서의 부서명이 teams.team_name 과 일치하면 그 팀,
//   아니면 미배정(NULL)으로 두어 총괄 재배정 큐(/unassigned)에서 처리한다. 팀을 임의 생성하지 않는다.
//   전력(소비전력/이중화)·희망 랙위치는 assets에 전용 컬럼이 없어 description에 보존(무손실).
// 호출부는 반출입 상태 변경과 같은 트랜잭션 안에서 부른다(부분 커밋 방지).
export function registerBroughtInAsset(db: Database.Database, movement: MovementRow, changedBy: string): number {
  const assetName = movement.equipment_desc || movement.model || "반입 장비";
  // 크기 "2U"/"2" → 정수 rack_unit_size (미상/0 이하는 기본 1U)
  const sizeNum = parseInt(String(movement.size_u ?? "").replace(/[^0-9]/g, ""), 10);
  const rackUnitSize = Number.isFinite(sizeNum) && sizeNum > 0 ? sizeNum : 1;
  const powerNote =
    movement.power_redundant === "yes" ? "전원 이중화"
      : movement.power_redundant === "no" ? "단일 전원" : "";
  const description = [
    movement.purpose,
    movement.power_watts ? `소비전력 ${movement.power_watts}` : "",
    powerNote,
    movement.rack_position ? `반입 희망 랙위치 ${movement.rack_position}` : "",
    movement.notes,
  ].filter(Boolean).join(" · ");

  const deptName = String(movement.department ?? "").trim();
  const team = deptName
    ? (db.prepare("SELECT id FROM teams WHERE TRIM(team_name) = ?").get(deptName) as { id: number } | undefined)
    : undefined;
  const teamId = team ? team.id : null;

  const row = {
    asset_type: "other",
    asset_name: assetName,
    manufacturer: movement.manufacturer || "",
    model: movement.model || "",
    serial_number: movement.serial_number || "",
    status: "active",
    team_id: teamId,
    rack_unit_size: rackUnitSize,
    description,
  };
  const assetId = Number(db.prepare(`
    INSERT INTO assets (asset_type, asset_name, manufacturer, model, serial_number,
      status, team_id, rack_unit_size, description)
    VALUES (@asset_type, @asset_name, @manufacturer, @model, @serial_number,
      @status, @team_id, @rack_unit_size, @description)
  `).run(row).lastInsertRowid);
  db.prepare("UPDATE asset_movements SET asset_id = ? WHERE id = ?").run(assetId, movement.id);

  logAssetChange(db, {
    assetId,
    assetName,
    action: "create",
    changedBy,
    newData: {
      ...row,
      _cause: teamId === null && deptName
        ? `반입 완료(#${movement.id}) 직접입력 장비의 자산 대장 자동 등록 — 신청 부서 '${deptName}' 와 일치하는 팀이 없어 미배정`
        : `반입 완료(#${movement.id}) 직접입력 장비의 자산 대장 자동 등록`,
    },
  });
  return assetId;
}

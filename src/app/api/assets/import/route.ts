import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { logAssetChange } from "@/lib/audit";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanWrite } from "@/lib/authz";
import {
  isXlsxBuffer,
  validateAssetRow,
  detectDuplicates,
  type IssueType,
} from "@/lib/validation/asset-rules";


// 고정 필드 인덱스 (키 행 기반)
const FIXED_KEYS = [
  "asset_type", "asset_name", "manufacturer", "model", "serial_number",
  "ip_address", "asset_tag", "status", "os", "access_ip",
  "user_name", "admin_name", "department",
  "purchase_date", "warranty_date", "eos_date",
  "rack_name", "rack_unit_start", "rack_unit_size", "description",
  "network_zone", "cia_c", "cia_i", "cia_a",
];

// 고정 필드 한글 라벨 (FIXED_KEYS와 1:1 대응) — 키 행 없는 일반 양식의 라벨 매핑용
const FIXED_LABELS = [
  "유형", "이름", "제조사", "모델", "시리얼번호",
  "IP주소", "자산태그", "상태", "OS", "접근IP",
  "사용자", "관리자", "부서",
  "구매일", "보증만료", "EoS",
  "랙이름", "시작U", "크기U", "설명",
  "망구분", "기밀성", "무결성", "가용성",
];

// 라벨 정규화 + 별칭 (키 행 없는 일반 양식의 유연한 매핑용)
const normLabel = (s: any) => String(s ?? "").replace(/\s+/g, "");
const LABEL_ALIASES: Record<string, string> = {
  "망구분": "network_zone", "망": "network_zone", "망분류": "network_zone",
  "기밀성": "cia_c", "기밀성c": "cia_c", "c": "cia_c",
  "무결성": "cia_i", "무결성i": "cia_i", "i": "cia_i",
  "가용성": "cia_a", "가용성a": "cia_a", "a": "cia_a",
  "관리부서": "department", "부서": "department", "담당부서": "department",
  "위치": "rack_name", "랙": "rack_name", "랙이름": "rack_name",
};

export async function POST(req: NextRequest) {
  const actor = await getActor();
  // 대량 가져오기는 쓰기 작업: viewer 차단, team/admin 허용
  try {
    assertCanWrite(actor);
  } catch (e) {
    const r = authzError(e);
    if (r) return r;
    throw e;
  }
  // team 계정은 가져온 자산을 자기 팀으로 강제; admin은 미지정(none)
  const ownerTeamId = actor?.role === "team" ? actor.teamId : null;
  const t0 = Date.now();
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  // 프리뷰(dry_run): 반영 없이 생성 예정/이슈 예상/기존 중복 의심만 산출 (외부 검토 R6-2 합의)
  const dryRun = String(formData.get("dry_run") || "") === "1";

  if (!file) {
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // 매직바이트 게이트: 확장자/Content-Type이 아닌 실제 바이트로 .xlsx 판별 (XLSX.read 전에 차단)
  if (!isXlsxBuffer(buffer)) {
    return NextResponse.json(
      { error: "유효한 .xlsx 파일이 아닙니다 (매직바이트 불일치)." },
      { status: 400 }
    );
  }

  const wb = XLSX.read(buffer);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1 });

  if (rows.length < 2) {
    return NextResponse.json({
      success: false, imported: 0, totalRows: 0,
      errors: [{ row: 0, column: "", value: "", error: "데이터 행이 없습니다. (헤더 + 데이터 필요)" }],
    });
  }

  const db = getDb();
  const headerRow = (rows[0] || []) as any[];
  const secondRow = (rows[1] || []) as any[];

  const colMap: Record<string, number> = {};
  const customFieldCols: { colIdx: number; fieldId: number; label: string }[] = [];

  // 2행이 키 매핑 행인지 판별 (고정키 또는 cf: 토큰 포함 → 우리 템플릿 양식)
  const hasKeyRow = secondRow.some((c) => {
    const s = String(c ?? "").trim();
    return FIXED_KEYS.includes(s) || s.startsWith("cf:");
  });

  let dataRows: any[][];
  let dataRowOffset: number;

  if (hasKeyRow) {
    // 템플릿 양식: 1행 헤더 + 2행 키매핑 + 3행~ 데이터
    for (let c = 0; c < secondRow.length; c++) {
      const key = String(secondRow[c] || "").trim();
      if (key.startsWith("cf:")) {
        const fieldId = parseInt(key.substring(3), 10);
        if (!isNaN(fieldId)) {
          customFieldCols.push({ colIdx: c, fieldId, label: String(headerRow[c] || `필드${fieldId}`) });
        }
      } else if (key) {
        colMap[key] = c;
      }
    }
    dataRows = rows.slice(2).filter((r: any[]) => r.some((c) => c !== undefined && c !== ""));
    dataRowOffset = 3;
  } else {
    // 일반 양식: 1행 헤더(한글 라벨) + 2행~ 데이터 — 헤더 라벨로 컬럼 매핑
    const labelToKey: Record<string, string> = {};
    FIXED_LABELS.forEach((label, i) => { labelToKey[label] = FIXED_KEYS[i]; });
    const cfRows = db.prepare("SELECT id, field_label FROM custom_fields WHERE is_active = 1").all() as any[];
    const cfByLabel = new Map<string, number>(cfRows.map((f: any) => [String(f.field_label).trim(), f.id as number]));
    const cfByNorm = new Map<string, number>(cfRows.map((f: any) => [normLabel(f.field_label).toLowerCase(), f.id as number]));
    for (let c = 0; c < headerRow.length; c++) {
      const label = String(headerRow[c] ?? "").trim();
      if (!label) continue;
      const nk = normLabel(label).toLowerCase();
      if (labelToKey[label] !== undefined) {
        colMap[labelToKey[label]] = c;
      } else if (LABEL_ALIASES[nk] !== undefined) {
        colMap[LABEL_ALIASES[nk]] = c;
      } else if (cfByLabel.has(label)) {
        customFieldCols.push({ colIdx: c, fieldId: cfByLabel.get(label)!, label });
      } else if (cfByNorm.has(nk)) {
        customFieldCols.push({ colIdx: c, fieldId: cfByNorm.get(nk)!, label });
      }
    }
    dataRows = rows.slice(1).filter((r: any[]) => r.some((c) => c !== undefined && c !== ""));
    dataRowOffset = 2;
  }

  // 매핑이 전혀 안 된 경우 — 순서 기반 폴백
  if (Object.keys(colMap).length === 0) {
    for (let c = 0; c < FIXED_KEYS.length && c < headerRow.length; c++) {
      colMap[FIXED_KEYS[c]] = c;
    }
  }

  if (dataRows.length === 0) {
    return NextResponse.json({
      success: false, imported: 0, totalRows: 0,
      errors: [{ row: 0, column: "", value: "", error: "데이터 행이 없습니다." }],
    });
  }

  function getVal(row: any[], key: string): string {
    const idx = colMap[key];
    if (idx === undefined) return "";
    const v = row[idx];
    return v !== undefined && v !== null ? String(v).trim() : "";
  }

  // 랙 매핑 (랙 이름 → id; 미존재/배치불가 시 rack_id null로 적재).
  // team 계정은 자기 소유 랙 또는 공유(team_id NULL) 랙에만 배치 가능 — 타팀 전용 랙은 매핑에서 제외.
  const allRacks = db.prepare("SELECT id, rack_name, team_id FROM racks").all() as any[];
  const rackMap = new Map(
    allRacks
      .filter((r: any) => actor?.role !== "team" || r.team_id == null || r.team_id === ownerTeamId)
      .map((r: any) => [r.rack_name, r.id]),
  );
  // 팀 매핑 (관리부서=팀명 → team_id). admin 업로드는 CLI 이관(import-asset-final)과 동일하게
  // find-or-create: 관리부서명이 teams에 없으면 팀을 새로 만들어 귀속(미배정으로 흘리지 않음).
  const teamByName = new Map<string, number>(
    (db.prepare("SELECT id, team_name FROM teams").all() as any[]).map((t: any) => [String(t.team_name).trim(), t.id as number]),
  );
  const insertTeamStmt = db.prepare("INSERT INTO teams (team_name) VALUES (?)");
  let teamsCreated = 0;
  function resolveTeamId(name: string): number | null {
    const n = name.trim();
    if (!n) return null; // 관리부서 공란 → 미배정
    const hit = teamByName.get(n);
    if (hit !== undefined) return hit;
    const id = Number(insertTeamStmt.run(n).lastInsertRowid);
    teamByName.set(n, id);
    teamsCreated++;
    return id;
  }

  // 커스텀 필드 유효성 확인
  const validFieldIds = new Set(
    (db.prepare("SELECT id FROM custom_fields WHERE is_active = 1").all() as any[]).map((f: any) => f.id)
  );
  const cfTypeStmt = db.prepare("SELECT field_type FROM custom_fields WHERE id = ?");

  // 행 전처리: validateAssetRow로 운영값/이슈 산출 + 랙/커스텀값 부착
  const prepared: {
    asset: ReturnType<typeof validateAssetRow>["asset"];
    issues: ReturnType<typeof validateAssetRow>["issues"];
    rack_id: number | null;
    team_id: number | null;
    customValues: { fieldId: number; value: string }[];
    sourceRow: number;
  }[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const sourceRow = i + dataRowOffset; // 1-indexed 시트 행

    // 모든 고정 키의 원본값을 raw로 수집 (department 포함 — validateAssetRow가 ADR-009에 따라 무시)
    const raw: Record<string, unknown> = {};
    for (const key of FIXED_KEYS) raw[key] = getVal(r, key);

    const { asset, issues } = validateAssetRow(raw);

    // 랙 해석: 이름이 매핑되면 id, 아니면 null (차단/이슈 없음 — 4개 enum 외 타입 불가)
    const rackName = getVal(r, "rack_name");
    const rack_id = rackName ? (rackMap.get(rackName) ?? null) : null;

    // 팀(소유) 해석: team 계정은 자기 팀 강제(보안), admin은 양식의 관리부서(팀명) → find-or-create.
    const deptName = getVal(r, "department");
    const team_id = actor?.role === "team" ? ownerTeamId : resolveTeamId(deptName);

    // 커스텀 필드 값 수집 (multi-text는 파이프 구분 → JSON 배열 변환)
    const customValues: { fieldId: number; value: string }[] = [];
    for (const cf of customFieldCols) {
      if (!validFieldIds.has(cf.fieldId)) continue;
      const val = r[cf.colIdx];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        let finalVal = String(val).trim();
        const fieldDef = cfTypeStmt.get(cf.fieldId) as any;
        if (fieldDef?.field_type === "multi-text" && finalVal.includes("|")) {
          finalVal = JSON.stringify(finalVal.split("|").map((s: string) => s.trim()).filter(Boolean));
        }
        customValues.push({ fieldId: cf.fieldId, value: finalVal });
      }
    }

    prepared.push({ asset, issues, rack_id, team_id, customValues, sourceRow });
  }

  // ── 프리뷰 모드: DB에 쓰지 않고 예상 결과만 반환 ──
  if (dryRun) {
    const issuePreview: Record<IssueType, number> = { ip_format: 0, missing_id: 0, missing_os: 0, dup_suspect: 0 };
    for (const p of prepared) for (const iss of p.issues) issuePreview[iss.issue_type]++;
    // 배치 내 동명 중복
    const { suspectIds } = detectDuplicates(prepared.map((p, i) => ({ id: i, asset_name: p.asset.asset_name, ip_address: p.asset.ip_address, serial_number: p.asset.serial_number })));
    issuePreview.dup_suspect = suspectIds.length;
    // 기존 대장과의 중복 의심: 동일 시리얼(정확 일치) 또는 동일 자산명
    const bySerial = db.prepare("SELECT id, asset_name FROM assets WHERE serial_number = ? AND serial_number != '' LIMIT 1");
    const byName = db.prepare("SELECT id, asset_name FROM assets WHERE asset_name = ? LIMIT 1");
    const dupExisting: { source_row: number; name: string; reason: string }[] = [];
    for (const p of prepared) {
      const s = (p.asset.serial_number || "").trim();
      const hitS = s ? (bySerial.get(s) as any) : null;
      const hitN = hitS ? null : (byName.get(p.asset.asset_name) as any);
      if (hitS) dupExisting.push({ source_row: p.sourceRow, name: p.asset.asset_name, reason: `기존 '${hitS.asset_name}'와 시리얼 동일` });
      else if (hitN) dupExisting.push({ source_row: p.sourceRow, name: p.asset.asset_name, reason: "기존 대장에 동명 자산 존재" });
      if (dupExisting.length >= 100) break;
    }
    return NextResponse.json({
      preview: true,
      would_create: prepared.length,
      totalRows: dataRows.length,
      issues: issuePreview,
      dup_existing: dupExisting,
      duration_ms: Date.now() - t0,
    });
  }

  // 업로드 배치 식별자
  const batch_id = `up-${Date.now()}`;

  const issueCounts: Record<IssueType, number> = {
    ip_format: 0, missing_id: 0, missing_os: 0, dup_suspect: 0,
  };
  const issueRows: { source_row: number | null; issue_type: IssueType; raw_value: string; note: string }[] = [];
  let imported = 0;
  const created: { id: number; asset_name: string; source_row: number }[] = [];

  // 트랜잭션: 자산 INSERT + 이슈 기록 + 중복 의심 기록을 한 단위로
  const insertAll = db.transaction(() => {
    // department는 운영 적재하지 않음(ADR-009) — INSERT 컬럼에서 제외(기본값 '')
    const assetStmt = db.prepare(`
      INSERT INTO assets (asset_type, asset_name, manufacturer, model, serial_number, ip_address, asset_tag,
        status, os, access_ip, user_name, admin_name,
        network_zone, cia_c, cia_i, cia_a,
        purchase_date, warranty_date, eos_date,
        rack_id, rack_unit_start, rack_unit_size, description, team_id, import_batch_id)
      VALUES (@asset_type, @asset_name, @manufacturer, @model, @serial_number, @ip_address, @asset_tag,
        @status, @os, @access_ip, @user_name, @admin_name,
        @network_zone, @cia_c, @cia_i, @cia_a,
        @purchase_date, @warranty_date, @eos_date,
        @rack_id, @rack_unit_start, @rack_unit_size, @description, @team_id, @import_batch_id)
    `);
    const cvStmt = db.prepare(
      "INSERT INTO custom_values (asset_id, field_id, value) VALUES (?, ?, ?) ON CONFLICT(asset_id, field_id) DO UPDATE SET value = excluded.value"
    );
    const issueStmt = db.prepare(
      "INSERT INTO import_issue (batch_id, source_row, asset_id, issue_type, raw_value, parsed_value, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );

    const insertedForDup: { id: number; asset_name: string; ip_address?: string; serial_number?: string }[] = [];

    for (const { asset, issues, rack_id, team_id, customValues, sourceRow } of prepared) {
      const { access_ips, ...assetCols } = asset;
      // 접근IP 다중값: 검증된 access_ips 전량을 access_ip 단일 컬럼에 ", " 조인 적재(다중 접근 IP 보존).
      assetCols.access_ip = access_ips.length ? access_ips.join(", ") : assetCols.access_ip;
      const result = assetStmt.run({
        ...assetCols,
        rack_id,
        team_id,
        import_batch_id: batch_id,
      });
      const assetId = Number(result.lastInsertRowid);
      imported++;

      for (const cv of customValues) {
        cvStmt.run(assetId, cv.fieldId, cv.value);
      }

      // malformed → import_issue (raw 보존, asset_id 연결, 행은 차단하지 않음)
      for (const issue of issues) {
        issueStmt.run(batch_id, sourceRow, assetId, issue.issue_type, issue.raw_value, issue.parsed_value, issue.note, actor?.username || '');
        issueCounts[issue.issue_type]++;
        if (issueRows.length < 200) {
          issueRows.push({ source_row: sourceRow, issue_type: issue.issue_type, raw_value: issue.raw_value, note: issue.note });
        }
      }

      insertedForDup.push({ id: assetId, asset_name: asset.asset_name, ip_address: asset.ip_address, serial_number: asset.serial_number });

      created.push({ id: assetId, asset_name: asset.asset_name, source_row: sourceRow });

      logAssetChange(db, {
        assetId,
        assetName: asset.asset_name,
        action: 'create',
        changedBy: actor?.username || 'system',
        // batch_id를 감사로그에도 남겨 배치 단위 사후 재구성 가능하게 (외부 검토 R8-4 합의)
        newData: { ...asset, import_batch_id: batch_id },
      });
    }

    // 동명 자산 중복 의심 → dup_suspect 이슈 (적재된 배치 기준)
    const nameById = new Map(insertedForDup.map((a) => [a.id, a.asset_name]));
    const { suspectIds } = detectDuplicates(insertedForDup);
    for (const sid of suspectIds) {
      const name = nameById.get(sid) ?? "";
      issueStmt.run(batch_id, null, sid, "dup_suspect", name, "", "동명 자산 다건", actor?.username || "");
      issueCounts.dup_suspect++;
      if (issueRows.length < 200) {
        issueRows.push({ source_row: null, issue_type: "dup_suspect", raw_value: name, note: "동명 자산 다건" });
      }
    }
  });

  insertAll();

  return NextResponse.json({
    success: true,
    imported,
    totalRows: dataRows.length,
    teamsCreated,
    batch_id,
    issues: {
      ip_format: issueCounts.ip_format,
      missing_id: issueCounts.missing_id,
      missing_os: issueCounts.missing_os,
      dup_suspect: issueCounts.dup_suspect,
    },
    issueRows,
    created,
    duration_ms: Date.now() - t0,
  });
}

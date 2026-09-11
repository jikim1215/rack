import { getDb } from "@/lib/db";
import { getActor, withApi } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, assertCanDownload } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { ValidationError } from "@/lib/validation/input";
import type { DistFrameRow, FrameType, LocationRow } from "@/lib/db-types";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

// ── 배선반 일괄 등록 (엑셀 왕복) ──
// GET: 양식 다운로드. POST: 같은 양식 업로드로 배선반+페어 일괄 생성.

const HEADERS = ["배선반명", "유형", "총페어", "위치명", "설명"];

const KO_TYPE: Record<string, string> = {
  "110블록": "110block",
  "패치패널": "patch_panel",
  "광패널": "optical",
  "기타": "other",
};
const VALID_TYPES = ["110block", "patch_panel", "optical", "other"] as const;

export const GET = withApi(async () => {
  const actor = await getActor();
  // 양식 다운로드는 읽기(+다운로드) 권한 — 원본 정책 복원 (비평 반영)
  assertMenuAccess(actor, "distribution");
  assertCanDownload(actor);

  const ws = XLSX.utils.aoa_to_sheet([
    HEADERS,
    ["MDF-1F-01", "110블록", 100, "본관 1층 MDF실", "본관 국선 인입"],
    ["PP-2F-01", "패치패널", 48, "본관 2층 TPS", "2층 사무실 패치패널"],
    ["FDF-1F-01", "광패널", 24, "본관 1층 MDF실", "간선 광 분배함"],
  ]);
  ws["!cols"] = [{ wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 20 }, { wch: 28 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "배선반양식");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("배선반양식.xlsx")}`,
    },
  });
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "distribution");
  assertCanWrite(actor);
  // team 계정이 업로드하면 자기 팀 소유로 생성. admin은 공유(NULL).
  const ownerTeamId = actor.role === "team" ? actor.teamId : null;
  const db = getDb();

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) throw new ValidationError("파일이 없습니다.");

  const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" }) as unknown[][];

  // 헤더 행 탐색 ("배선반명"으로 시작하는 행)
  const hIdx = aoa.findIndex((r) => String(r[0]).trim() === "배선반명");
  if (hIdx < 0) {
    throw new ValidationError("양식이 올바르지 않습니다 ('배선반명' 헤더 없음). 먼저 양식을 다운로드해 같은 형식으로 작성하세요.");
  }
  const header = aoa[hIdx].map((h) => String(h).trim());
  const col = (name: string) => header.indexOf(name);
  const v = (r: unknown[], name: string) => (col(name) >= 0 ? String(r[col(name)] ?? "").trim() : "");
  const dataRows = aoa.slice(hIdx + 1).filter((r) => String(r[col("배선반명")]).trim() !== "");

  const locations = db.prepare("SELECT id, location_name FROM locations ORDER BY id").all() as Pick<LocationRow, "id" | "location_name">[];
  if (locations.length === 0) {
    throw new ValidationError("등록된 위치가 없습니다. 먼저 위치를 등록하세요.");
  }
  const locByName = new Map(locations.map((l) => [l.location_name, l.id]));

  const existingNames = new Set(
    (db.prepare("SELECT frame_name FROM dist_frames").all() as Pick<DistFrameRow, "frame_name">[]).map((f) => f.frame_name)
  );

  const issues: string[] = [];
  let created = 0, skipped = 0;
  const createdLogs: Array<{ id: number; data: Record<string, unknown> }> = [];

  const insertFrame = db.prepare(`
    INSERT INTO dist_frames (location_id, frame_name, frame_type, total_pairs, description, team_id)
    VALUES (@location_id, @frame_name, @frame_type, @total_pairs, @description, @team_id)
  `);
  const insertPair = db.prepare("INSERT INTO frame_pairs (frame_id, pair_number) VALUES (?, ?)");

  db.transaction(() => {
    for (let i = 0; i < dataRows.length; i++) {
      const r = dataRows[i];
      const rowNo = hIdx + i + 2; // 엑셀 표시 행번호
      const frameName = v(r, "배선반명");

      // 중복(기존 DB 또는 파일 내) 스킵
      if (existingNames.has(frameName)) {
        skipped++;
        issues.push(`${rowNo}행: 배선반 '${frameName}' 이미 존재 — 건너뜀`);
        continue;
      }
      existingNames.add(frameName);

      // 유형: 한글/영문 허용, 그 외 110block 기본값
      const typeRaw = v(r, "유형");
      let frameType: FrameType | "" = (KO_TYPE[typeRaw] as FrameType) || ((VALID_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as FrameType) : "");
      if (!frameType) {
        if (typeRaw) issues.push(`${rowNo}행: 유형 '${typeRaw}' 인식 불가 — 110블록으로 등록`);
        frameType = "110block";
      }

      // 총페어: 1~2000 클램프 (기본 50)
      const totalPairs = Math.max(1, Math.min(2000, Number(v(r, "총페어")) || 50));

      // 위치명 매칭, 없으면 첫 위치
      const locName = v(r, "위치명");
      let locationId = locName ? locByName.get(locName) : undefined;
      if (locationId == null) {
        if (locName) issues.push(`${rowNo}행: 위치 '${locName}' 없음 — '${locations[0].location_name}'(으)로 등록`);
        locationId = locations[0].id;
      }

      const data = {
        location_id: locationId,
        frame_name: frameName,
        frame_type: frameType,
        total_pairs: totalPairs,
        description: v(r, "설명"),
        team_id: ownerTeamId,
      };
      const result = insertFrame.run(data);
      const frameId = Number(result.lastInsertRowid);
      for (let p = 1; p <= totalPairs; p++) insertPair.run(frameId, p);

      createdLogs.push({ id: frameId, data });
      created++;
    }
  })();

  for (const { id, data } of createdLogs) {
    logAudit(db, {
      entityType: "frame",
      entityId: id,
      entityName: String(data.frame_name),
      action: "create",
      changedBy: actor.username,
      newData: data,
    });
  }

  return NextResponse.json({ created, skipped, issues });
});

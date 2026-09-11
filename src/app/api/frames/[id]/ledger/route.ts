import { getDb } from "@/lib/db";
import { getActor, withApi } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { pathId, ValidationError } from "@/lib/validation/input";
import type { DistFrameRow, FramePairRow, PairStatus } from "@/lib/db-types";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

// ── 선번장 엑셀 왕복 (FDF A안 ④) ──
// GET: 프레임 단위 선번장 다운로드. POST: 같은 양식 업로드로 일괄 갱신 + 대향 링크 반영.

type Ctx = { params: Promise<{ id: string }> };

const STATUS_KO: Record<string, string> = { used: "사용중", unused: "미사용", reserved: "예약", faulty: "장애" };
const KO_STATUS: Record<string, string> = { "사용중": "used", "미사용": "unused", "예약": "reserved", "장애": "faulty", "사용": "used" };
const VALID_STATUSES = ["used", "unused", "reserved", "faulty"] as const;

const HEADERS = ["포트", "코어번호", "상태", "라벨", "케이블ID", "출발(상위)", "도착(내선/아웃렛)", "사용자", "대향 배선반", "대향 포트", "연결 장비", "연결 포트", "비고"];

export const GET = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuAccess(actor, "distribution");
  const id = pathId((await params).id);
  const db = getDb();

  const frame = db.prepare(`
    SELECT df.*, l.location_name, l.building, l.floor FROM dist_frames df
    LEFT JOIN locations l ON df.location_id = l.id WHERE df.id = ?
  `).get(id) as (DistFrameRow & { location_name: string | null; building: string | null; floor: string | null }) | undefined;
  if (!frame) return NextResponse.json({ error: "배선반이 없습니다." }, { status: 404 });
  if (actor.role === "team" && frame.team_id !== actor.teamId) {
    return NextResponse.json({ error: "배선반이 없습니다." }, { status: 404 });
  }

  const pairs = db.prepare(`
    SELECT fp.*, lp.pair_number AS linked_pair_number, lf.frame_name AS linked_frame_name,
           p.port_number AS connected_port_number, p.port_name AS connected_port_name,
           a.asset_name AS connected_asset_name
    FROM frame_pairs fp
    LEFT JOIN frame_pairs lp ON fp.linked_pair_id = lp.id
    LEFT JOIN dist_frames lf ON lp.frame_id = lf.id
    LEFT JOIN ports p ON fp.connected_port_id = p.id
    LEFT JOIN assets a ON p.asset_id = a.id
    WHERE fp.frame_id = ? ORDER BY fp.pair_number
  `).all(id) as (FramePairRow & {
    linked_pair_number: number | null; linked_frame_name: string | null;
    connected_port_number: number | null; connected_port_name: string | null;
    connected_asset_name: string | null;
  })[];

  const rows = pairs.map((p) => [
    p.pair_number,
    p.core_number ?? "",
    STATUS_KO[p.status] || p.status,
    p.label || "",
    p.cable_id || "",
    p.source || "",
    p.destination || "",
    p.user_info || "",
    p.linked_frame_name || "",
    p.linked_pair_number ?? "",
    p.connected_asset_name || "",
    p.connected_port_name || (p.connected_port_number != null ? `#${p.connected_port_number}` : ""),
    p.description || "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([
    [`선번장 — ${frame.frame_name} (${frame.frame_type}) · ${[frame.building, frame.floor, frame.location_name].filter(Boolean).join(" ")}`],
    HEADERS,
    ...rows,
  ]);
  ws["!cols"] = [{ wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 18 }, { wch: 14 }, { wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 9 }, { wch: 20 }, { wch: 10 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "선번장");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`선번장-${frame.frame_name}.xlsx`)}`,
    },
  });
});

export const POST = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "distribution");
  const id = pathId((await params).id);
  const db = getDb();

  const frame = db.prepare("SELECT df.*, df.frame_type AS ftype FROM dist_frames df WHERE df.id = ?").get(id) as (DistFrameRow & { ftype: string }) | undefined;
  if (!frame) return NextResponse.json({ error: "배선반이 없습니다." }, { status: 404 });
  assertCanWrite(actor, frame.team_id ?? null);

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) throw new ValidationError("파일이 없습니다.");

  const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" }) as unknown[][];

  // 헤더 행 탐색 ("포트"로 시작하는 행)
  const hIdx = aoa.findIndex((r) => String(r[0]).trim() === "포트");
  if (hIdx < 0) throw new ValidationError("양식이 올바르지 않습니다 ('포트' 헤더 없음). 먼저 선번장을 다운로드해 같은 양식으로 작성하세요.");
  const header = aoa[hIdx].map((h) => String(h).trim());
  const col = (name: string) => header.indexOf(name);
  const dataRows = aoa.slice(hIdx + 1).filter((r) => String(r[col("포트")]).trim() !== "");

  const issues: string[] = [];
  let updated = 0, linked = 0, unlinked = 0;

  interface FrameLite { id: number; frame_name: string; frame_type: string }
  const framesByName = new Map(
    (db.prepare("SELECT id, frame_name, frame_type FROM dist_frames").all() as FrameLite[]).map((f) => [f.frame_name, f])
  );
  const upsert = db.prepare(`
    INSERT INTO frame_pairs (frame_id, pair_number, status, label, source, destination, cable_id, user_info, description, core_number)
    VALUES (@frame_id, @pair_number, @status, @label, @source, @destination, @cable_id, @user_info, @description, @core_number)
    ON CONFLICT(frame_id, pair_number) DO UPDATE SET
      status = excluded.status, label = excluded.label, source = excluded.source,
      destination = excluded.destination, cable_id = excluded.cable_id,
      user_info = excluded.user_info, description = excluded.description, core_number = excluded.core_number
  `);
  const getPair = db.prepare("SELECT id, linked_pair_id FROM frame_pairs WHERE frame_id = ? AND pair_number = ?");
  const setLink = db.prepare("UPDATE frame_pairs SET linked_pair_id = ? WHERE id = ?");

  const v = (r: unknown[], name: string) => (col(name) >= 0 ? String(r[col(name)] ?? "").trim() : "");

  db.transaction(() => {
    for (const r of dataRows) {
      const pairNumber = Number(v(r, "포트"));
      if (!pairNumber || pairNumber < 1 || pairNumber > frame.total_pairs) {
        issues.push(`포트 '${v(r, "포트")}' — 1~${frame.total_pairs} 범위를 벗어나 건너뜀`);
        continue;
      }
      const statusRaw = v(r, "상태");
      const status: PairStatus = (KO_STATUS[statusRaw] as PairStatus) || ((VALID_STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as PairStatus) : "unused");
      const core = v(r, "코어번호");
      upsert.run({
        frame_id: id, pair_number: pairNumber, status,
        label: v(r, "라벨"), source: v(r, "출발(상위)"), destination: v(r, "도착(내선/아웃렛)"),
        cable_id: v(r, "케이블ID"), user_info: v(r, "사용자"), description: v(r, "비고"),
        core_number: core && /^\d+$/.test(core) ? Number(core) : null,
      });
      updated++;

      // 대향 링크 반영 (빈 값이면 링크 해제)
      const me = getPair.get(id, pairNumber) as Pick<FramePairRow, "id" | "linked_pair_id">;
      const oppName = v(r, "대향 배선반");
      const oppPort = Number(v(r, "대향 포트"));
      if (!oppName) {
        if (me.linked_pair_id != null) {
          setLink.run(null, me.linked_pair_id);
          setLink.run(null, me.id);
          unlinked++;
        }
        continue;
      }
      const oppFrame = framesByName.get(oppName);
      if (!oppFrame) { issues.push(`#${pairNumber}: 대향 배선반 '${oppName}' 없음`); continue; }
      if (oppFrame.frame_type !== frame.frame_type) { issues.push(`#${pairNumber}: 유형 불일치 (${frame.frame_type} ↔ ${oppFrame.frame_type})`); continue; }
      if (oppFrame.id === id) { issues.push(`#${pairNumber}: 같은 배선반과 연결 불가`); continue; }
      if (!oppPort) { issues.push(`#${pairNumber}: 대향 포트 번호 누락`); continue; }
      const opp = getPair.get(oppFrame.id, oppPort) as Pick<FramePairRow, "id" | "linked_pair_id"> | undefined;
      if (!opp) { issues.push(`#${pairNumber}: ${oppName} #${oppPort} 페어 없음`); continue; }
      if (me.linked_pair_id === opp.id) continue; // 이미 연결됨
      if (me.linked_pair_id != null) { setLink.run(null, me.linked_pair_id); setLink.run(null, me.id); }
      if (opp.linked_pair_id != null && opp.linked_pair_id !== me.id) {
        issues.push(`#${pairNumber}: ${oppName} #${oppPort}은(는) 이미 다른 페어와 연결됨 — 건너뜀`);
        continue;
      }
      setLink.run(opp.id, me.id);
      setLink.run(me.id, opp.id);
      linked++;
    }
  })();

  logAudit(db, {
    entityType: "frame", entityId: id, entityName: frame.frame_name, action: "update",
    changedBy: actor.username,
    oldData: { ledger_import: "" },
    newData: { ledger_import: `${updated}행 갱신, 링크 ${linked}건, 해제 ${unlinked}건, 이슈 ${issues.length}건` },
  });

  return NextResponse.json({ updated, linked, unlinked, issues });
});

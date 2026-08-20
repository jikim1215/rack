import { getDb } from "@/lib/db";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanWrite } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

// ── 선번장 양단 링크 (FDF A안) ──
// 페어↔페어 1:1 대칭 링크. 한쪽에서 연결/해제하면 반대쪽도 함께 갱신된다.
// 검증: 자기 자신 금지, 같은 프레임 금지, 다른 frame_type 금지(광↔동선 교차 방지), 이미 연결된 페어 재연결 금지(409).

interface PairRow {
  id: number;
  frame_id: number;
  pair_number: number;
  linked_pair_id: number | null;
  frame_name: string;
  frame_type: string;
  team_id: number | null;
}

function getPair(db: ReturnType<typeof getDb>, id: number): PairRow | undefined {
  return db.prepare(`
    SELECT fp.id, fp.frame_id, fp.pair_number, fp.linked_pair_id, df.frame_name, df.frame_type, df.team_id
    FROM frame_pairs fp JOIN dist_frames df ON fp.frame_id = df.id
    WHERE fp.id = ?
  `).get(id) as PairRow | undefined;
}

export async function POST(req: NextRequest) {
  const actor = await getActor();
  try { assertCanWrite(actor); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const body = await req.json();
  const db = getDb();

  const aId = Number(body.pair_a_id);
  const bId = Number(body.pair_b_id);
  if (!aId || !bId) return NextResponse.json({ error: "pair_a_id, pair_b_id가 필요합니다." }, { status: 400 });
  if (aId === bId) return NextResponse.json({ error: "자기 자신과 연결할 수 없습니다." }, { status: 400 });

  const a = getPair(db, aId);
  const b = getPair(db, bId);
  if (!a || !b) return NextResponse.json({ error: "존재하지 않는 페어입니다." }, { status: 404 });

  // 소유 전용: 팀은 자기 팀 배선반의 페어만 연결 가능(양쪽 모두).
  try { assertCanWrite(actor, a.team_id ?? null); assertCanWrite(actor, b.team_id ?? null); }
  catch (e) { const r = authzError(e); if (r) return r; throw e; }

  // 이미 서로 연결돼 있으면 멱등 성공
  if (a.linked_pair_id === b.id && b.linked_pair_id === a.id) {
    return NextResponse.json({ ok: true, already: true });
  }
  if (a.frame_id === b.frame_id) {
    return NextResponse.json({ error: "같은 배선반 내 페어끼리는 연결할 수 없습니다." }, { status: 400 });
  }
  if (a.frame_type !== b.frame_type) {
    return NextResponse.json({ error: `배선반 유형이 다릅니다 (${a.frame_type} ↔ ${b.frame_type}). 광↔광, 110블록↔110블록처럼 같은 유형끼리만 연결됩니다.` }, { status: 400 });
  }
  if (a.linked_pair_id != null) {
    return NextResponse.json({ error: `${a.frame_name} #${a.pair_number}은(는) 이미 다른 페어와 연결되어 있습니다. 먼저 해제하세요.` }, { status: 409 });
  }
  if (b.linked_pair_id != null) {
    return NextResponse.json({ error: `${b.frame_name} #${b.pair_number}은(는) 이미 다른 페어와 연결되어 있습니다. 먼저 해제하세요.` }, { status: 409 });
  }

  db.transaction(() => {
    db.prepare("UPDATE frame_pairs SET linked_pair_id = ? WHERE id = ?").run(b.id, a.id);
    db.prepare("UPDATE frame_pairs SET linked_pair_id = ? WHERE id = ?").run(a.id, b.id);
  })();

  const who = actor?.username || "system";
  logAudit(db, {
    entityType: "frame", entityId: a.frame_id, entityName: a.frame_name, action: "update", changedBy: who,
    oldData: { [`pair_${a.pair_number}_link`]: "" },
    newData: { [`pair_${a.pair_number}_link`]: `${b.frame_name} #${b.pair_number}` },
  });
  logAudit(db, {
    entityType: "frame", entityId: b.frame_id, entityName: b.frame_name, action: "update", changedBy: who,
    oldData: { [`pair_${b.pair_number}_link`]: "" },
    newData: { [`pair_${b.pair_number}_link`]: `${a.frame_name} #${a.pair_number}` },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const actor = await getActor();
  try { assertCanWrite(actor); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const body = await req.json().catch(() => ({}));
  const db = getDb();

  const pairId = Number(body.pair_id);
  if (!pairId) return NextResponse.json({ error: "pair_id가 필요합니다." }, { status: 400 });

  const p = getPair(db, pairId);
  if (!p) return NextResponse.json({ error: "존재하지 않는 페어입니다." }, { status: 404 });
  // 소유 전용: 팀은 자기 팀 배선반의 페어만 해제 가능.
  try { assertCanWrite(actor, p.team_id ?? null); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  if (p.linked_pair_id == null) return NextResponse.json({ ok: true, already: true });

  const other = getPair(db, p.linked_pair_id);

  db.transaction(() => {
    db.prepare("UPDATE frame_pairs SET linked_pair_id = NULL WHERE id = ?").run(p.id);
    if (other) db.prepare("UPDATE frame_pairs SET linked_pair_id = NULL WHERE id = ?").run(other.id);
  })();

  const who = actor?.username || "system";
  logAudit(db, {
    entityType: "frame", entityId: p.frame_id, entityName: p.frame_name, action: "update", changedBy: who,
    oldData: { [`pair_${p.pair_number}_link`]: other ? `${other.frame_name} #${other.pair_number}` : "?" },
    newData: { [`pair_${p.pair_number}_link`]: "" },
  });
  if (other) {
    logAudit(db, {
      entityType: "frame", entityId: other.frame_id, entityName: other.frame_name, action: "update", changedBy: who,
      oldData: { [`pair_${other.pair_number}_link`]: `${p.frame_name} #${p.pair_number}` },
      newData: { [`pair_${other.pair_number}_link`]: "" },
    });
  }

  return NextResponse.json({ ok: true });
}

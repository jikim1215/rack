import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuWrite, assertCanWrite } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { asBody, int, ValidationError } from "@/lib/validation/input";
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

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "distribution");
  const b = asBody(await readJson(req));
  const db = getDb();

  const aId = int(b, "pair_a_id", { required: true, min: 1, label: "pair_a_id" }) as number;
  const bId = int(b, "pair_b_id", { required: true, min: 1, label: "pair_b_id" }) as number;
  if (aId === bId) throw new ValidationError("자기 자신과 연결할 수 없습니다.");

  const a = getPair(db, aId);
  const b2 = getPair(db, bId);
  if (!a || !b2) return NextResponse.json({ error: "존재하지 않는 페어입니다." }, { status: 404 });

  // 소유 전용: 팀은 자기 팀 배선반의 페어만 연결 가능(양쪽 모두).
  assertCanWrite(actor, a.team_id ?? null);
  assertCanWrite(actor, b2.team_id ?? null);

  // 이미 서로 연결돼 있으면 멱등 성공
  if (a.linked_pair_id === b2.id && b2.linked_pair_id === a.id) {
    return NextResponse.json({ ok: true, already: true });
  }
  if (a.frame_id === b2.frame_id) {
    return NextResponse.json({ error: "같은 배선반 내 페어끼리는 연결할 수 없습니다." }, { status: 400 });
  }
  if (a.frame_type !== b2.frame_type) {
    return NextResponse.json({ error: `배선반 유형이 다릅니다 (${a.frame_type} ↔ ${b2.frame_type}). 광↔광, 110블록↔110블록처럼 같은 유형끼리만 연결됩니다.` }, { status: 400 });
  }
  if (a.linked_pair_id != null) {
    return NextResponse.json({ error: `${a.frame_name} #${a.pair_number}은(는) 이미 다른 페어와 연결되어 있습니다. 먼저 해제하세요.` }, { status: 409 });
  }
  if (b2.linked_pair_id != null) {
    return NextResponse.json({ error: `${b2.frame_name} #${b2.pair_number}은(는) 이미 다른 페어와 연결되어 있습니다. 먼저 해제하세요.` }, { status: 409 });
  }

  db.transaction(() => {
    db.prepare("UPDATE frame_pairs SET linked_pair_id = ? WHERE id = ?").run(b2.id, a.id);
    db.prepare("UPDATE frame_pairs SET linked_pair_id = ? WHERE id = ?").run(a.id, b2.id);
  })();

  const who = actor.username;
  logAudit(db, {
    entityType: "frame", entityId: a.frame_id, entityName: a.frame_name, action: "update", changedBy: who,
    oldData: { [`pair_${a.pair_number}_link`]: "" },
    newData: { [`pair_${a.pair_number}_link`]: `${b2.frame_name} #${b2.pair_number}` },
  });
  logAudit(db, {
    entityType: "frame", entityId: b2.frame_id, entityName: b2.frame_name, action: "update", changedBy: who,
    oldData: { [`pair_${b2.pair_number}_link`]: "" },
    newData: { [`pair_${b2.pair_number}_link`]: `${a.frame_name} #${a.pair_number}` },
  });

  return NextResponse.json({ ok: true });
});

export const DELETE = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "distribution");
  const b = asBody(await readJson(req));
  const db = getDb();

  const pairId = int(b, "pair_id", { required: true, min: 1, label: "pair_id" }) as number;

  const p = getPair(db, pairId);
  if (!p) return NextResponse.json({ error: "존재하지 않는 페어입니다." }, { status: 404 });
  // 소유 전용: 팀은 자기 팀 배선반의 페어만 해제 가능.
  assertCanWrite(actor, p.team_id ?? null);
  if (p.linked_pair_id == null) return NextResponse.json({ ok: true, already: true });

  const other = getPair(db, p.linked_pair_id);

  db.transaction(() => {
    db.prepare("UPDATE frame_pairs SET linked_pair_id = NULL WHERE id = ?").run(p.id);
    if (other) db.prepare("UPDATE frame_pairs SET linked_pair_id = NULL WHERE id = ?").run(other.id);
  })();

  const who = actor.username;
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
});

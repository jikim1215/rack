import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuWrite, assertCanWrite } from "@/lib/authz";
import { asBody, idOrNull, pathId } from "@/lib/validation/input";
import type { PortRow } from "@/lib/db-types";

export const PUT = withApi(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await getActor();
  assertMenuWrite(actor, "assets");
  const id = pathId((await params).id);
  const db = getDb();

  const port = db.prepare("SELECT * FROM ports WHERE id = ?").get(id) as PortRow | undefined;
  if (!port) return NextResponse.json({ error: "포트를 찾을 수 없습니다." }, { status: 404 });

  // 소유 권위는 포트가 속한 자산의 team_id (ports.asset_id 는 NOT NULL).
  const portAsset = db.prepare("SELECT team_id FROM assets WHERE id = ?").get(port.asset_id) as { team_id: number | null } | undefined;
  const ownerTeamId: number | null = portAsset ? portAsset.team_id : null;
  assertCanWrite(actor, ownerTeamId);

  const body = asBody(await readJson(req));
  const targetPortId = idOrNull(body, "connected_to_port_id", "연결 대상 포트");

  // 연결 대상 포트도 변경되므로 그 자산의 team_id 에 대해서도 쓰기 권한 검증.
  let targetPort: PortRow | undefined;
  if (targetPortId) {
    targetPort = db.prepare("SELECT * FROM ports WHERE id = ?").get(targetPortId) as PortRow | undefined;
    if (!targetPort) return NextResponse.json({ error: "대상 포트를 찾을 수 없습니다." }, { status: 404 });
    const targetAsset = db.prepare("SELECT team_id FROM assets WHERE id = ?").get(targetPort.asset_id) as { team_id: number | null } | undefined;
    const targetOwnerTeamId: number | null = targetAsset ? targetAsset.team_id : null;
    assertCanWrite(actor, targetOwnerTeamId);
  }

  // 양방향 연결 갱신은 원자적으로 처리 (중간 실패 시 반쪽 연결 상태 방지)
  const applyLink = db.transaction(() => {
    // 기존 연결 해제 (양방향)
    if (port.connected_to_port_id) {
      db.prepare("UPDATE ports SET connected_to_port_id = NULL WHERE id = ?").run(port.connected_to_port_id);
    }

    if (targetPortId && targetPort) {
      // 대상 포트의 기존 연결도 해제
      if (targetPort.connected_to_port_id) {
        db.prepare("UPDATE ports SET connected_to_port_id = NULL WHERE id = ?").run(targetPort.connected_to_port_id);
      }

      // 양방향 연결 설정
      db.prepare("UPDATE ports SET connected_to_port_id = ? WHERE id = ?").run(targetPortId, id);
      db.prepare("UPDATE ports SET connected_to_port_id = ? WHERE id = ?").run(id, targetPortId);
    } else {
      // 연결 해제
      db.prepare("UPDATE ports SET connected_to_port_id = NULL WHERE id = ?").run(id);
    }
  });
  applyLink();

  return NextResponse.json({ ok: true });
});

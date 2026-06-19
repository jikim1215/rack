import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  const port = db.prepare("SELECT * FROM ports WHERE id = ?").get(Number(id)) as any;
  if (!port) return NextResponse.json({ error: "포트를 찾을 수 없습니다." }, { status: 404 });

  const targetPortId = body.connected_to_port_id ?? null;

  // 기존 연결 해제 (양방향)
  if (port.connected_to_port_id) {
    db.prepare("UPDATE ports SET connected_to_port_id = NULL WHERE id = ?").run(port.connected_to_port_id);
  }

  if (targetPortId) {
    // 대상 포트의 기존 연결도 해제
    const targetPort = db.prepare("SELECT * FROM ports WHERE id = ?").get(Number(targetPortId)) as any;
    if (!targetPort) return NextResponse.json({ error: "대상 포트를 찾을 수 없습니다." }, { status: 404 });
    if (targetPort.connected_to_port_id) {
      db.prepare("UPDATE ports SET connected_to_port_id = NULL WHERE id = ?").run(targetPort.connected_to_port_id);
    }

    // 양방향 연결 설정
    db.prepare("UPDATE ports SET connected_to_port_id = ? WHERE id = ?").run(Number(targetPortId), Number(id));
    db.prepare("UPDATE ports SET connected_to_port_id = ? WHERE id = ?").run(Number(id), Number(targetPortId));
  } else {
    // 연결 해제
    db.prepare("UPDATE ports SET connected_to_port_id = NULL WHERE id = ?").run(Number(id));
  }

  return NextResponse.json({ ok: true });
}

import { getDb } from "@/lib/db";
import { getActor, authzError } from "@/lib/api-authz";
import { assertCanRead, assertCanWrite, scopeWhere } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";

// 계약에 연결된 자산 목록
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  try { assertCanRead(actor); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const { id } = await params;
  const db = getDb();
  const scope = scopeWhere(actor, "a.team_id");
  const assets = db.prepare(`
    SELECT a.id, a.asset_name, a.asset_type, a.ip_address, a.status
    FROM contract_assets ca
    JOIN assets a ON ca.asset_id = a.id
    WHERE ca.contract_id = ? AND ${scope.sql}
    ORDER BY a.asset_name
  `).all(Number(id), ...scope.params);
  return NextResponse.json(assets);
}

// 계약에 자산 연결
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const { asset_id } = await req.json();
  if (!asset_id) return NextResponse.json({ error: "asset_id required" }, { status: 400 });

  const db = getDb();
  // 계약 소유 팀 + 연결 자산 소유 팀 모두 기준으로 쓰기 권한 검사 (팀은 자기 계약·자산만)
  const contract = db.prepare("SELECT team_id FROM contracts WHERE id = ?").get(Number(id)) as { team_id: number | null } | undefined;
  if (!contract) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
  try { assertCanWrite(actor, contract.team_id); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const asset = db.prepare("SELECT team_id FROM assets WHERE id = ?").get(Number(asset_id)) as { team_id: number | null } | undefined;
  if (!asset) return NextResponse.json({ error: "자산을 찾을 수 없습니다." }, { status: 404 });
  try { assertCanWrite(actor, asset.team_id); } catch (e) { const r = authzError(e); if (r) return r; throw e; }

  try {
    db.prepare("INSERT INTO contract_assets (contract_id, asset_id) VALUES (?, ?)").run(Number(id), Number(asset_id));
  } catch {
    return NextResponse.json({ error: "이미 연결된 자산입니다." }, { status: 409 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

// 계약에서 자산 연결 해제
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  const { id } = await params;
  const assetId = req.nextUrl.searchParams.get("asset_id");
  if (!assetId) return NextResponse.json({ error: "asset_id required" }, { status: 400 });

  const db = getDb();
  // 계약 소유 팀 + 해제 자산 소유 팀 모두 기준으로 쓰기 권한 검사 (팀은 자기 계약·자산만)
  const contract = db.prepare("SELECT team_id FROM contracts WHERE id = ?").get(Number(id)) as { team_id: number | null } | undefined;
  if (!contract) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
  try { assertCanWrite(actor, contract.team_id); } catch (e) { const r = authzError(e); if (r) return r; throw e; }
  const asset = db.prepare("SELECT team_id FROM assets WHERE id = ?").get(Number(assetId)) as { team_id: number | null } | undefined;
  if (!asset) return NextResponse.json({ error: "자산을 찾을 수 없습니다." }, { status: 404 });
  try { assertCanWrite(actor, asset.team_id); } catch (e) { const r = authzError(e); if (r) return r; throw e; }

  db.prepare("DELETE FROM contract_assets WHERE contract_id = ? AND asset_id = ?").run(Number(id), Number(assetId));
  return NextResponse.json({ ok: true });
}

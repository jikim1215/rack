import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// 계약에 연결된 자산 목록
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const assets = db.prepare(`
    SELECT a.id, a.asset_name, a.asset_type, a.ip_address, a.status
    FROM contract_assets ca
    JOIN assets a ON ca.asset_id = a.id
    WHERE ca.contract_id = ?
    ORDER BY a.asset_name
  `).all(Number(id));
  return NextResponse.json(assets);
}

// 계약에 자산 연결
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { asset_id } = await req.json();
  if (!asset_id) return NextResponse.json({ error: "asset_id required" }, { status: 400 });

  const db = getDb();
  try {
    db.prepare("INSERT INTO contract_assets (contract_id, asset_id) VALUES (?, ?)").run(Number(id), Number(asset_id));
  } catch {
    return NextResponse.json({ error: "이미 연결된 자산입니다." }, { status: 409 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

// 계약에서 자산 연결 해제
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const assetId = req.nextUrl.searchParams.get("asset_id");
  if (!assetId) return NextResponse.json({ error: "asset_id required" }, { status: 400 });

  const db = getDb();
  db.prepare("DELETE FROM contract_assets WHERE contract_id = ? AND asset_id = ?").run(Number(id), Number(assetId));
  return NextResponse.json({ ok: true });
}

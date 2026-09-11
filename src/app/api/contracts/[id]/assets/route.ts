import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite, scopeWhere } from "@/lib/authz";
import { asBody, pathId, idOrNull, ValidationError } from "@/lib/validation/input";
import { NextRequest, NextResponse } from "next/server";
import type { AssetRow, ContractRow } from "@/lib/db-types";

type Ctx = { params: Promise<{ id: string }> };

// 계약에 연결된 자산 목록
export const GET = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuAccess(actor, "contracts");
  const id = pathId((await params).id);
  const db = getDb();
  const scope = scopeWhere(actor, "a.team_id");
  const assets = db.prepare(`
    SELECT a.id, a.asset_name, a.asset_type, a.ip_address, a.status
    FROM contract_assets ca
    JOIN assets a ON ca.asset_id = a.id
    WHERE ca.contract_id = ? AND ${scope.sql}
    ORDER BY a.asset_name
  `).all(id, ...scope.params) as Pick<AssetRow, "id" | "asset_name" | "asset_type" | "ip_address" | "status">[];
  return NextResponse.json(assets);
});

// 계약에 자산 연결
export const POST = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "contracts");
  const id = pathId((await params).id);
  const b = asBody(await readJson(req));
  const assetId = idOrNull(b, "asset_id", "자산");
  if (!assetId) throw new ValidationError("asset_id required");

  const db = getDb();
  // 계약 소유 팀 + 연결 자산 소유 팀 모두 기준으로 쓰기 권한 검사 (팀은 자기 계약·자산만)
  const contract = db.prepare("SELECT team_id FROM contracts WHERE id = ?").get(id) as Pick<ContractRow, "team_id"> | undefined;
  if (!contract) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
  assertCanWrite(actor, contract.team_id);
  const asset = db.prepare("SELECT team_id FROM assets WHERE id = ?").get(assetId) as Pick<AssetRow, "team_id"> | undefined;
  if (!asset) return NextResponse.json({ error: "자산을 찾을 수 없습니다." }, { status: 404 });
  assertCanWrite(actor, asset.team_id);

  try {
    db.prepare("INSERT INTO contract_assets (contract_id, asset_id) VALUES (?, ?)").run(id, assetId);
  } catch {
    return NextResponse.json({ error: "이미 연결된 자산입니다." }, { status: 409 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
});

// 계약에서 자산 연결 해제
export const DELETE = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "contracts");
  const id = pathId((await params).id);
  const assetIdRaw = req.nextUrl.searchParams.get("asset_id");
  if (!assetIdRaw) throw new ValidationError("asset_id required");
  const assetId = pathId(assetIdRaw, "asset_id");

  const db = getDb();
  // 계약 소유 팀 + 해제 자산 소유 팀 모두 기준으로 쓰기 권한 검사 (팀은 자기 계약·자산만)
  const contract = db.prepare("SELECT team_id FROM contracts WHERE id = ?").get(id) as Pick<ContractRow, "team_id"> | undefined;
  if (!contract) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
  assertCanWrite(actor, contract.team_id);
  const asset = db.prepare("SELECT team_id FROM assets WHERE id = ?").get(assetId) as Pick<AssetRow, "team_id"> | undefined;
  if (!asset) return NextResponse.json({ error: "자산을 찾을 수 없습니다." }, { status: 404 });
  assertCanWrite(actor, asset.team_id);

  db.prepare("DELETE FROM contract_assets WHERE contract_id = ? AND asset_id = ?").run(id, assetId);
  return NextResponse.json({ ok: true });
});

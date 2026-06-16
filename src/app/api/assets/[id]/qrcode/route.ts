import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const asset = db.prepare("SELECT * FROM assets WHERE id = ?").get(
    Number(id)
  ) as any;

  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const qrData = JSON.stringify({
    id: asset.id,
    asset_tag: asset.asset_tag,
    name: asset.name,
    serial_number: asset.serial_number,
  });

  const qrDataUrl = await QRCode.toDataURL(qrData, { width: 256 });

  return NextResponse.json({
    qrDataUrl,
    asset_tag: asset.asset_tag,
    name: asset.name,
    serial_number: asset.serial_number,
    manufacturer: asset.manufacturer,
    model: asset.model,
  });
}

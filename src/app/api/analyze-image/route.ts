import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { photoId } = body;

  if (!photoId) {
    return NextResponse.json({ error: "photoId required" }, { status: 400 });
  }

  const db = getDb();
  const photo = db.prepare("SELECT * FROM asset_photos WHERE id = ?").get(
    Number(photoId)
  ) as { filename: string } | undefined;

  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  const filepath = path.join(UPLOAD_DIR, photo.filename);

  try {
    const analyzer = (await import("@/lib/analyzers")).getAnalyzer();
    const result = await analyzer.analyze(filepath);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Analysis failed" },
      { status: 500 }
    );
  }
}

import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "fs";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const photos = db.prepare(
    "SELECT * FROM asset_photos WHERE asset_id = ? ORDER BY created_at DESC"
  ).all(Number(id));
  return NextResponse.json(photos);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Invalid file type. Allowed: jpeg, png, webp" },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Max 10MB" },
      { status: 400 }
    );
  }

  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  const ext = file.name.split(".").pop() || "jpg";
  const filename = `${randomUUID()}.${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  writeFileSync(filepath, buffer);

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO asset_photos (asset_id, filename, original_name, mime_type)
    VALUES (?, ?, ?, ?)
  `).run(Number(id), filename, file.name, file.type);

  const photo = db.prepare("SELECT * FROM asset_photos WHERE id = ?").get(
    result.lastInsertRowid
  );

  return NextResponse.json(photo, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _id } = await params;
  const photoId = req.nextUrl.searchParams.get("photoId");

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
    unlinkSync(filepath);
  } catch {
    // file may already be deleted
  }

  db.prepare("DELETE FROM asset_photos WHERE id = ?").run(Number(photoId));
  return NextResponse.json({ ok: true });
}

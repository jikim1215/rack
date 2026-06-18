import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  db.prepare(`
    UPDATE vendors SET vendor_name = @vendor_name, contact_person = @contact_person, phone = @phone,
      email = @email, address = @address, business_number = @business_number,
      vendor_type = @vendor_type, notes = @notes
    WHERE id = @id
  `).run({
    id: Number(id),
    vendor_name: body.vendor_name,
    contact_person: body.contact_person || "",
    phone: body.phone || "",
    email: body.email || "",
    address: body.address || "",
    business_number: body.business_number || "",
    vendor_type: body.vendor_type || "maintenance",
    notes: body.notes || "",
  });
  const vendor = db.prepare("SELECT * FROM vendors WHERE id = ?").get(Number(id));
  return NextResponse.json(vendor);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  db.prepare("UPDATE vendors SET is_active = 0 WHERE id = ?").run(Number(id));
  return NextResponse.json({ success: true });
}

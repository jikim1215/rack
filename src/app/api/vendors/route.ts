import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const db = getDb();
  const vendors = db.prepare(`SELECT * FROM vendors WHERE is_active = 1 ORDER BY vendor_name`).all();
  return NextResponse.json(vendors);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO vendors (vendor_name, contact_person, phone, email, address, business_number, vendor_type, notes)
    VALUES (@vendor_name, @contact_person, @phone, @email, @address, @business_number, @vendor_type, @notes)
  `).run({
    vendor_name: body.vendor_name,
    contact_person: body.contact_person || "",
    phone: body.phone || "",
    email: body.email || "",
    address: body.address || "",
    business_number: body.business_number || "",
    vendor_type: body.vendor_type || "maintenance",
    notes: body.notes || "",
  });
  const vendor = db.prepare("SELECT * FROM vendors WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(vendor, { status: 201 });
}

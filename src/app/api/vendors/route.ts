import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertCanWrite } from "@/lib/authz";
import { asBody, str, oneOf, flag } from "@/lib/validation/input";
import { NextRequest, NextResponse } from "next/server";
import type { VendorRow } from "@/lib/db-types";

export const GET = withApi(async (_req: NextRequest) => {
  const actor = await getActor();
  assertMenuAccess(actor, "contracts");
  const db = getDb();
  const vendors = db.prepare(`SELECT * FROM vendors WHERE is_active = 1 ORDER BY vendor_name`).all() as VendorRow[];
  return NextResponse.json(vendors);
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  assertMenuWrite(actor, "contracts");
  assertCanWrite(actor);
  const b = asBody(await readJson(req));
  const db = getDb();
  const values = {
    vendor_name: str(b, "vendor_name", { required: true, max: 200, label: "업체명" }),
    contact_person: str(b, "contact_person", { max: 100, label: "담당자" }),
    phone: str(b, "phone", { max: 50, label: "연락처" }),
    email: str(b, "email", { max: 200, label: "이메일" }),
    address: str(b, "address", { max: 500, label: "주소" }),
    business_number: str(b, "business_number", { max: 50, label: "사업자번호" }),
    vendor_type: oneOf(b, "vendor_type", ["maintenance", "supplier", "other"] as const, { default: "maintenance", label: "업체 유형" }),
    is_active: flag(b, "is_active", 1),
    notes: str(b, "notes", { max: 2000, label: "비고" }),
  };
  const result = db.prepare(`
    INSERT INTO vendors (vendor_name, contact_person, phone, email, address, business_number, vendor_type, is_active, notes)
    VALUES (@vendor_name, @contact_person, @phone, @email, @address, @business_number, @vendor_type, @is_active, @notes)
  `).run(values);
  const vendor = db.prepare("SELECT * FROM vendors WHERE id = ?").get(result.lastInsertRowid) as VendorRow;
  return NextResponse.json(vendor, { status: 201 });
});

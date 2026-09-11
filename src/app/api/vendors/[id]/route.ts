import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuWrite, assertCanWrite, assertCanDelete } from "@/lib/authz";
import { asBody, str, oneOf, flag, pathId } from "@/lib/validation/input";
import { NextRequest, NextResponse } from "next/server";
import type { VendorRow } from "@/lib/db-types";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withApi(async (req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "contracts");
  assertCanWrite(actor);
  const id = pathId((await params).id);
  const b = asBody(await readJson(req));
  const db = getDb();
  const existing = db.prepare("SELECT is_active FROM vendors WHERE id = ?").get(id) as Pick<VendorRow, "is_active"> | undefined;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  db.prepare(`
    UPDATE vendors SET vendor_name = @vendor_name, contact_person = @contact_person, phone = @phone,
      email = @email, address = @address, business_number = @business_number,
      vendor_type = @vendor_type, is_active = @is_active, notes = @notes
    WHERE id = @id
  `).run({
    id,
    vendor_name: str(b, "vendor_name", { required: true, max: 200, label: "업체명" }),
    contact_person: str(b, "contact_person", { max: 100, label: "담당자" }),
    phone: str(b, "phone", { max: 50, label: "연락처" }),
    email: str(b, "email", { max: 200, label: "이메일" }),
    address: str(b, "address", { max: 500, label: "주소" }),
    business_number: str(b, "business_number", { max: 50, label: "사업자번호" }),
    vendor_type: oneOf(b, "vendor_type", ["maintenance", "supplier", "other"] as const, { default: "maintenance", label: "업체 유형" }),
    // is_active 는 본문에 있을 때만 바꾼다 (비활성 업체 편집이 재활성으로 샐지 않게, 비평 반영)
    is_active: "is_active" in b ? flag(b, "is_active", 1) : existing.is_active,
    notes: str(b, "notes", { max: 2000, label: "비고" }),
  });
  const vendor = db.prepare("SELECT * FROM vendors WHERE id = ?").get(id) as VendorRow;
  return NextResponse.json(vendor);
});

export const DELETE = withApi(async (_req: NextRequest, { params }: Ctx) => {
  const actor = await getActor();
  assertMenuWrite(actor, "contracts");
  assertCanDelete(actor);
  const id = pathId((await params).id);
  const db = getDb();
  db.prepare("UPDATE vendors SET is_active = 0 WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
});

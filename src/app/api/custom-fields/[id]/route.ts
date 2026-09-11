import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuWrite, assertAdmin } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { asBody, str, oneOf, int, flag, pathId } from "@/lib/validation/input";
import type { CustomFieldRow, CustomFieldType } from "@/lib/db-types";

const FIELD_TYPES = ["text", "number", "date", "select", "textarea", "multi-text"] as const;

export const PUT = withApi(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await getActor();
  assertAdmin(actor);
  assertMenuWrite(actor, "assets");
  const id = pathId((await params).id);
  const body = asBody(await readJson(req));
  const db = getDb();

  const field_label = str(body, "field_label", { required: true, max: 200, label: "필드 라벨" });
  const field_type: CustomFieldType = oneOf(body, "field_type", FIELD_TYPES, { default: "text", label: "필드 유형" });
  const field_group = str(body, "field_group", { max: 100, default: "기본", label: "필드 그룹" });
  const options = str(body, "options", { max: 2000, label: "선택지" });
  const asset_types = str(body, "asset_types", { max: 500, label: "적용 자산유형" });
  const sort_order = int(body, "sort_order", { default: 0, label: "정렬순서" }) ?? 0;
  const is_required = flag(body, "is_required", 0);
  const show_in_table = flag(body, "show_in_table", 0);
  const show_in_detail = flag(body, "show_in_detail", 1);

  db.prepare(`
    UPDATE custom_fields SET
      field_label = @field_label, field_type = @field_type, field_group = @field_group,
      options = @options, asset_types = @asset_types, sort_order = @sort_order,
      is_required = @is_required, show_in_table = @show_in_table, show_in_detail = @show_in_detail
    WHERE id = @id
  `).run({
    id,
    field_label,
    field_type,
    field_group,
    options,
    asset_types,
    sort_order,
    is_required,
    show_in_table,
    show_in_detail,
  });

  const field = db.prepare("SELECT * FROM custom_fields WHERE id = ?").get(id) as CustomFieldRow | undefined;
  return NextResponse.json(field);
});

export const DELETE = withApi(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await getActor();
  assertAdmin(actor);
  assertMenuWrite(actor, "assets");
  const id = pathId((await params).id);
  const db = getDb();
  db.prepare("UPDATE custom_fields SET is_active = 0 WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
});

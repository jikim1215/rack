import { getDb } from "@/lib/db";
import { getActor, withApi, readJson } from "@/lib/api-authz";
import { assertMenuAccess, assertMenuWrite, assertAdmin } from "@/lib/authz";
import { NextRequest, NextResponse } from "next/server";
import { asBody, str, oneOf, int, flag } from "@/lib/validation/input";
import type { CustomFieldRow, CustomFieldType } from "@/lib/db-types";

const FIELD_TYPES = ["text", "number", "date", "select", "textarea", "multi-text"] as const;

export const GET = withApi(async () => {
  const actor = await getActor();
  assertMenuAccess(actor, "assets");
  const db = getDb();
  const fields = db.prepare("SELECT * FROM custom_fields WHERE is_active = 1 ORDER BY field_group, sort_order, id").all() as CustomFieldRow[];
  return NextResponse.json(fields);
});

export const POST = withApi(async (req: NextRequest) => {
  const actor = await getActor();
  // 커스텀 필드 정의는 총괄 전용 관리 기능 + 메뉴 쓰기 권한 모두 강제
  assertAdmin(actor);
  assertMenuWrite(actor, "assets");
  const body = asBody(await readJson(req));
  const db = getDb();

  const field_key = str(body, "field_key", { required: true, max: 100, label: "필드 키" });
  const field_label = str(body, "field_label", { required: true, max: 200, label: "필드 라벨" });
  const field_type: CustomFieldType = oneOf(body, "field_type", FIELD_TYPES, { default: "text", label: "필드 유형" });
  const field_group = str(body, "field_group", { max: 100, default: "기본", label: "필드 그룹" });
  const options = str(body, "options", { max: 2000, label: "선택지" });
  const asset_types = str(body, "asset_types", { max: 500, label: "적용 자산유형" });
  const sort_order = int(body, "sort_order", { default: 0, label: "정렬순서" }) ?? 0;
  const is_required = flag(body, "is_required", 0);
  const show_in_table = flag(body, "show_in_table", 0);
  const show_in_detail = flag(body, "show_in_detail", 1);

  const result = db.prepare(`
    INSERT INTO custom_fields (field_key, field_label, field_type, field_group, options, asset_types, sort_order, is_required, show_in_table, show_in_detail)
    VALUES (@field_key, @field_label, @field_type, @field_group, @options, @asset_types, @sort_order, @is_required, @show_in_table, @show_in_detail)
  `).run({
    field_key,
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

  const field = db.prepare("SELECT * FROM custom_fields WHERE id = ?").get(result.lastInsertRowid) as CustomFieldRow;
  return NextResponse.json(field, { status: 201 });
});

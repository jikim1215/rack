import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const entityType = req.nextUrl.searchParams.get("entity_type");
  const entityId = req.nextUrl.searchParams.get("entity_id");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 200);

  const VALID_ENTITY_TYPES = ["asset", "rack", "location", "frame", "contract", "movement", "maintenance"];

  let query = "SELECT * FROM audit_logs";
  const conditions: string[] = [];
  const params: any[] = [];

  if (entityType) {
    if (!VALID_ENTITY_TYPES.includes(entityType)) {
      return NextResponse.json({ error: "Invalid entity_type" }, { status: 400 });
    }
    conditions.push("entity_type = ?");
    params.push(entityType);
  }
  if (entityId) {
    conditions.push("entity_id = ?");
    params.push(Number(entityId));
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  const logs = db.prepare(query).all(...params) as any[];

  const parsed = logs.map((log) => ({
    ...log,
    changed_fields: safeJsonParse(log.changed_fields, []),
    old_values: safeJsonParse(log.old_values, {}),
    new_values: safeJsonParse(log.new_values, {}),
  }));

  return NextResponse.json(parsed);
}

function safeJsonParse(str: string, fallback: any): any {
  try { return JSON.parse(str); } catch { return fallback; }
}

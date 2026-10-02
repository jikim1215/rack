// tests/fixtures/schema-dump.mjs — schema-parity.test.ts 가 자식 프로세스로 실행한다.
// ASSET_DB_PATH 의 DB 를 getDb()(=initSchema + 전 마이그레이션)로 연 뒤, 정규화된 스키마를 JSON 으로 stdout 에 쓴다.
// getDb() 는 프로세스 단일 연결(싱글턴)이라 DB 마다 별도 프로세스가 필요하다.
import Database from "better-sqlite3";

const { getDb } = await import("../../src/lib/db.ts");
getDb().close();

const db = new Database(process.env.ASSET_DB_PATH, { readonly: true });
const norm = (s) => (s || "").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").replace(/"/g, "").trim();
// CHECK(...) 본문 — 괄호 3단 중첩까지 (IN (...) / 함수 호출 포함)
const CHECK_RE = /CHECK\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/gi;

const out = { user_version: db.pragma("user_version", { simple: true }), tables: {}, indexes: {}, triggers: {}, views: {} };
for (const r of db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()) {
  if (r.type === "table") {
    out.tables[r.name] = {
      cols: db.prepare(`PRAGMA table_xinfo("${r.name}")`).all()
        .map((c) => `${c.name} ${c.type}${c.notnull ? " NOT NULL" : ""}${c.dflt_value != null ? ` DEFAULT ${c.dflt_value}` : ""}${c.pk ? ` PK${c.pk}` : ""}`)
        .sort(),
      fks: db.prepare(`PRAGMA foreign_key_list("${r.name}")`).all()
        .map((f) => `${f.from} -> ${f.table}.${f.to} ON DELETE ${f.on_delete} ON UPDATE ${f.on_update}`)
        .sort(),
      checks: (norm(r.sql).match(CHECK_RE) || []).sort(),
      // UNIQUE/PK 제약으로 생긴 자동 인덱스 (명시 CREATE INDEX 는 indexes 에서 비교)
      constraints: db.prepare(`PRAGMA index_list("${r.name}")`).all()
        .filter((i) => i.origin !== "c")
        .map((i) => `${i.origin}:${db.prepare(`PRAGMA index_info("${i.name}")`).all().map((c) => c.name).join(",")}`)
        .sort(),
    };
  } else if (r.type === "index" && r.sql) out.indexes[r.name] = `${r.tbl_name}: ${norm(r.sql)}`;
  else if (r.type === "trigger") out.triggers[r.name] = norm(r.sql);
  else if (r.type === "view") out.views[r.name] = norm(r.sql);
}
db.close();
process.stdout.write(JSON.stringify(out));

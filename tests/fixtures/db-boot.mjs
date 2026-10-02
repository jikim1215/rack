// tests/fixtures/db-boot.mjs — "서버 1회 기동" 을 흉내 낸다: getDb()(= initSchema + 전 마이그레이션) 후
// BOOT_SQL(선택, 세미콜론 구분 쓰기 SQL)을 실행하고, BOOT_QUERY(선택, SELECT 1개)의 결과와
// 각 테이블의 rootpage(테이블이 DROP/CREATE 로 재생성되면 바뀐다)를 JSON 으로 stdout 에 쓴다.
const { getDb } = await import("../../src/lib/db.ts");
const db = getDb();
if (process.env.BOOT_SQL) db.exec(process.env.BOOT_SQL);
const rows = process.env.BOOT_QUERY ? db.prepare(process.env.BOOT_QUERY).all() : [];
const rootpages = Object.fromEntries(
  db.prepare("SELECT name, rootpage FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => [r.name, r.rootpage]),
);
db.close();
process.stdout.write(JSON.stringify({ rows, rootpages }));

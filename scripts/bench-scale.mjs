// ── 확장성 벤치마크: 자산 1만 건 시나리오 ──
// 운영 DB 를 스크래치로 복사해 자산을 N건까지 증식시킨 뒤, 앱이 실제로 쓰는 쿼리를 측정한다.
// 원본 DB 는 열지 않는다(복사본만 수정). 사용: node scripts/bench-scale.mjs [목표건수] [원본DB]
import Database from "better-sqlite3";
import { copyFileSync, rmSync, statSync, existsSync } from "fs";

const TARGET = Number(process.argv[2] || 10000);
const SRC = process.argv[3] || "data.db";
const WORK = ".bench-scale.db";

if (!existsSync(SRC)) { console.error(`원본 DB 없음: ${SRC}`); process.exit(1); }
for (const s of ["", "-wal", "-shm"]) rmSync(WORK + s, { force: true });
copyFileSync(SRC, WORK);

const db = new Database(WORK);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
const ms = (fn, runs = 5) => {
  fn(); // warm-up (페이지 캐시 적재 — 2회차부터가 실사용에 가깝다)
  const t = [];
  for (let i = 0; i < runs; i++) { const s = process.hrtime.bigint(); fn(); t.push(Number(process.hrtime.bigint() - s) / 1e6); }
  t.sort((a, b) => a - b);
  return { med: t[Math.floor(runs / 2)], max: t[runs - 1] };
};

console.log(`원본 자산 ${count("assets")}건 → ${TARGET}건으로 증식 중...`);

// 기존 행을 복제해 증식 (컬럼 구성·분포를 그대로 유지 — 합성 데이터보다 현실적)
const cols = db.prepare("PRAGMA table_xinfo(assets)").all().filter((c) => Number(c.hidden) === 0 && c.name !== "id").map((c) => c.name);
const colList = cols.join(",");
const grow = db.transaction(() => {
  let n = count("assets");
  let round = 0;
  while (n < TARGET) {
    const need = Math.min(n, TARGET - n);
    // asset_name 에 접미사를 붙여 중복 탐지 로직이 비현실적으로 몰리지 않게 한다
    db.prepare(`
      INSERT INTO assets (${colList})
      SELECT ${cols.map((c) => (c === "asset_name" ? `asset_name || '-c${round}'` : c === "serial_number" ? `CASE WHEN serial_number='' THEN '' ELSE serial_number || 'C${round}' END` : c)).join(",")}
      FROM assets WHERE id IN (SELECT id FROM assets ORDER BY id LIMIT ${need})
    `).run();
    n = count("assets");
    round++;
  }
  // 다중 IP·커스텀값도 비례 증식 (JOIN/EXISTS 비용을 실제와 맞추기 위해).
  // 운영 비율을 적용: 실제로는 자산의 약 30% 가 다중 IP 를 가진다고 보고 3천 행 수준을 만든다.
  const ipSeed = db.prepare("SELECT ip_address, ip_type, interface_name, subnet_mask, gateway, description FROM asset_ips LIMIT 1").get()
    ?? { ip_address: "10.0.0.1", ip_type: "service", interface_name: "eth0", subnet_mask: "255.255.255.0", gateway: "10.0.0.254", description: "" };
  const insIp = db.prepare(`INSERT INTO asset_ips (asset_id, ip_address, ip_type, interface_name, subnet_mask, gateway, is_primary, description)
                            VALUES (?,?,?,?,?,?,0,?)`);
  const targets = db.prepare("SELECT id FROM assets WHERE id % 3 = 0").all();
  for (const t of targets) {
    insIp.run(t.id, `10.${(t.id >> 8) & 255}.${t.id & 255}.${(t.id % 250) + 1}`, "vip", ipSeed.interface_name, ipSeed.subnet_mask, ipSeed.gateway, ipSeed.description);
  }
  // 커스텀 필드 값도 증식 (상세·내보내기 경로의 JOIN 비용)
  const cf = db.prepare("SELECT id FROM custom_fields WHERE is_active = 1 LIMIT 1").get();
  if (cf) {
    const insCv = db.prepare("INSERT OR IGNORE INTO custom_values (asset_id, field_id, value) VALUES (?,?,?)");
    for (const t of db.prepare("SELECT id FROM assets WHERE id % 2 = 0").all()) insCv.run(t.id, cf.id, `V-${t.id}`);
  }
});
grow();

console.log(`증식 완료: 자산 ${count("assets")} · 다중IP ${count("asset_ips")} · 커스텀값 ${count("custom_values")} · 감사로그 ${count("audit_logs")}`);
console.log(`DB 크기: ${(statSync(WORK).size / 1048576).toFixed(1)}MB\n`);

// ── 앱이 실제로 쓰는 쿼리들 ──
const SCOPE = "(1 = 1)"; // admin 스코프(최악: 전체 행)
const IP_SEARCH = (t) => `(a.ip_address LIKE '%${t}%'
  OR EXISTS (SELECT 1 FROM asset_ips ai WHERE ai.asset_id = a.id AND ai.ip_address LIKE '%${t}%')
  OR EXISTS (SELECT 1 FROM custom_values cv JOIN custom_fields cf ON cv.field_id = cf.id
             WHERE cv.asset_id = a.id AND cf.field_key = 'additional_ips' AND cv.value LIKE '%${t}%'))`;

const LIST_SQL = `
  SELECT a.*, r.rack_name, l.location_name
  FROM assets a LEFT JOIN racks r ON a.rack_id = r.id
  LEFT JOIN locations l ON r.location_id = l.id
  WHERE ${SCOPE} AND (1 = 1) ORDER BY a.created_at DESC`;

const cases = [
  ["자산 목록 — 전량(현재 기본 동작)", () => db.prepare(LIST_SQL).all()],
  ["자산 목록 — LIMIT 100 (페이지네이션 경로)", () => db.prepare(LIST_SQL + " LIMIT 100 OFFSET 0").all()],
  ["자산 목록 — LIMIT 100 OFFSET 9900 (마지막 페이지)", () => db.prepare(LIST_SQL + " LIMIT 100 OFFSET 9900").all()],
  ["IP 검색(다중IP UNION) — LIMIT 100", () => db.prepare(`SELECT a.id FROM assets a WHERE ${SCOPE} AND ${IP_SEARCH("10.")} LIMIT 100`).all()],
  ["IP 검색 — 전량 COUNT", () => db.prepare(`SELECT COUNT(*) c FROM assets a WHERE ${SCOPE} AND ${IP_SEARCH("10.")}`).get()],
  ["대시보드 — 유형별 집계", () => db.prepare(`SELECT asset_type, COUNT(*) c FROM assets WHERE ${SCOPE} GROUP BY asset_type`).all()],
  ["대시보드 — 데이터 품질 4종", () => db.prepare(`SELECT SUM(ip_address='') a, SUM(admin_name='') b, SUM(rack_id IS NULL) c, SUM(os='') d FROM assets WHERE ${SCOPE}`).get()],
  ["대시보드 — 랙 사용률(자산 LEFT JOIN)", () => db.prepare(`
      SELECT r.id, r.rack_name, r.total_units, COALESCE(SUM(a.rack_unit_size),0) used
      FROM racks r LEFT JOIN assets a ON a.rack_id = r.id AND ${SCOPE} GROUP BY r.id`).all()],
  ["정리큐 뷰 v_cleanup_queue — COUNT", () => db.prepare(`SELECT COUNT(*) c FROM v_cleanup_queue q JOIN assets a ON q.asset_id = a.id WHERE ${SCOPE}`).get()],
  ["정리큐 뷰 — 상위 50건", () => db.prepare(`SELECT q.* FROM v_cleanup_queue q JOIN assets a ON q.asset_id = a.id WHERE ${SCOPE} LIMIT 50`).all()],
  ["중복 의심(동명 그룹)", () => db.prepare(`SELECT asset_name, COUNT(*) c FROM assets WHERE ${SCOPE} GROUP BY asset_name HAVING c > 1`).all()],
  ["엑셀 내보내기 — 전량 + 커스텀값", () => {
    db.prepare(LIST_SQL).all();
    db.prepare("SELECT cv.asset_id, cv.field_id, cv.value FROM custom_values cv JOIN custom_fields cf ON cv.field_id = cf.id WHERE cf.is_active = 1").all();
  }],
  ["감사로그 — 최근 50건", () => db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 50").all()],
  ["자산 1건 상세(IP+커스텀값)", () => {
    const id = db.prepare("SELECT id FROM assets ORDER BY RANDOM() LIMIT 1").get().id;
    db.prepare("SELECT * FROM assets WHERE id = ?").get(id);
    db.prepare("SELECT * FROM asset_ips WHERE asset_id = ?").all(id);
    db.prepare("SELECT cv.* FROM custom_values cv WHERE cv.asset_id = ?").all(id);
  }],
];

console.log("쿼리                                              중앙값      최대      건수/비고");
console.log("─".repeat(92));
for (const [name, fn] of cases) {
  const { med, max } = ms(fn);
  let extra = "";
  try { const r = fn(); extra = Array.isArray(r) ? `${r.length}행` : ""; } catch { /* noop */ }
  const flag = med > 300 ? " ⚠" : med > 100 ? " ·" : "";
  console.log(`${name.padEnd(48)} ${med.toFixed(1).padStart(8)}ms ${max.toFixed(1).padStart(8)}ms  ${extra}${flag}`);
}

// 응답 페이로드 크기 — DB 가 아니라 여기가 병목일 수 있다
const rows = db.prepare(LIST_SQL).all();
const json = JSON.stringify(rows);
console.log("─".repeat(92));
console.log(`전량 응답 JSON: ${(Buffer.byteLength(json) / 1048576).toFixed(1)}MB (${rows.length}행)`);

db.close();
for (const s of ["", "-wal", "-shm"]) rmSync(WORK + s, { force: true });

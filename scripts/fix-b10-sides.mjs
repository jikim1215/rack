#!/usr/bin/env node
// B-10 랙 반폭(하프폭) 장비 rack_side 백필 스크립트.
// 같은 rack_unit_start를 공유하는 자산 쌍(2대)에 id 오름차순으로 L(좌)/R(우)를 부여한다.
// 규칙은 src/lib/rack-overlap.ts와 동일: 같은 U라도 L/R 반폭은 공존 가능(충돌 아님).
// 3대 이상이 같은 시작 U를 공유하면 반폭으로 해소 불가 → 경고 후 건너뜀.
// 재실행해도 같은 결과(멱등). rack_side만 갱신하고 다른 컬럼은 건드리지 않는다.
//
// 실행: node scripts/fix-b10-sides.mjs
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.ASSET_DB_PATH ? path.resolve(process.env.ASSET_DB_PATH) : path.join(__dirname, "..", "data.db");

const db = new Database(DB);

const racks = db.prepare("SELECT id, rack_name FROM racks WHERE rack_name = 'B-10'").all();
if (racks.length === 0) {
  console.error("B-10 랙을 찾을 수 없습니다.");
  process.exit(1);
}

const update = db.prepare("UPDATE assets SET rack_side = ? WHERE id = ?");
let totalUpdated = 0;

const tx = db.transaction(() => {
  for (const rack of racks) {
    const rows = db.prepare(`
      SELECT id, asset_name, rack_unit_start, rack_unit_size, rack_side
      FROM assets
      WHERE rack_id = ? AND rack_unit_start IS NOT NULL
      ORDER BY rack_unit_start, id
    `).all(rack.id);

    // 시작 U별 그룹화
    const byStart = new Map();
    for (const r of rows) {
      if (!byStart.has(r.rack_unit_start)) byStart.set(r.rack_unit_start, []);
      byStart.get(r.rack_unit_start).push(r);
    }

    for (const [start, group] of byStart) {
      if (group.length < 2) continue; // 단독 배치는 전폭 유지
      if (group.length > 2) {
        console.warn(`⚠ ${rack.rack_name} ${start}U: ${group.length}대가 같은 시작 U를 공유 — 반폭(L/R)으로 해소 불가, 건너뜀`);
        continue;
      }
      // id 오름차순: 낮은 id → L(좌), 높은 id → R(우)
      const [lo, hi] = [...group].sort((a, b) => a.id - b.id);
      update.run("L", lo.id);
      update.run("R", hi.id);
      totalUpdated += 2;
      console.log(`${rack.rack_name} ${start}U: #${lo.id} ${lo.asset_name} → L(좌), #${hi.id} ${hi.asset_name} → R(우)`);
    }
  }
});
tx();

console.log(`완료: ${totalUpdated}대에 rack_side 부여`);

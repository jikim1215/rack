// ── 재기동 유실 값 복구 (감사로그 재생) ──
// 결함(2026-10-01 판에서 수정): 2026-10-01 이전 판은 서버가 기동할 때마다 assets 테이블을 고정 컬럼 목록으로
// 재생성해, 아래 5개 값이 재시작마다 비워졌다. 감사로그(audit_logs, append-only)는 영향을 받지 않았으므로
// 자산별 마지막 기록값을 되살릴 수 있다.
//   team_id(소유 팀) · rack_side(반폭 L/R) · verified_at/verified_by(현행 확인 도장) · import_batch_id(일괄등록 배치)
//
// 복구 규칙 — 운영자의 현재 값을 절대 덮어쓰지 않는다:
//   1. 현재 값이 비어 있는(NULL/'') 필드만 채운다.
//   2. 해당 자산 감사로그에서 그 필드의 **가장 마지막** 기록값을 쓴다. 마지막 기록이 '해제(빈 값)' 면 복구하지 않는다.
//   3. team_id 는 팀이 아직 존재할 때만. rack_side 는 그 기록 **이후 랙 위치(rack_id/시작U)가 바뀌지 않았을 때만**
//      (L/R 는 그 위치에서만 의미가 있다 — 전폭→반폭 축소라 겹침이 생기지 않는다).
//   4. verified_at 과 verified_by 는 같은 감사 행에서 함께 가져온다.
//   5. --apply 일 때만 쓴다(단일 트랜잭션). 복구한 자산마다 감사로그 1행(changed_by=system:restore-lost-fields).
//      다시 실행하면 채울 것이 없으므로 0건 — 멱등.
//
// 사용 (서비스 중지 상태에서 — 구판이 떠 있으면 다음 재시작에 다시 지워진다):
//   sudo -u asset /opt/asset-inventory/node/bin/node /opt/asset-inventory/scripts/deploy/restore-lost-fields.cjs          # 미리보기
//   sudo -u asset /opt/asset-inventory/node/bin/node /opt/asset-inventory/scripts/deploy/restore-lost-fields.cjs --apply  # 적용
// 업그레이드(upgrade-inplace.sh)는 새 앱 교체 직후·기동 전에 자동 실행한다(DB 백업 이후).
// 환경변수: APP_DIR(기본 /opt/asset-inventory), ASSET_DB_PATH(기본 $APP_DIR/data.db)
"use strict";
const path = require("node:path");

const ACTOR = "system:restore-lost-fields";
const CAUSE = "재기동 유실 복구(2026-10-01 결함) — 감사로그 마지막 기록값";
const empty = (v) => v === null || v === undefined || v === "";

/** 복구 계획 산출 (읽기만 한다). 반환: [{ id, asset_name, set: { col: value } }] */
function planRestore(db) {
  const assets = new Map(
    db.prepare("SELECT id, asset_name, team_id, rack_id, rack_unit_start, rack_side, verified_at, verified_by, import_batch_id FROM assets")
      .all().map((a) => [a.id, a]),
  );
  const teams = new Set(db.prepare("SELECT id FROM teams").all().map((t) => t.id));
  // 자산별 마지막 기록 — { team_id, rack_side, verified, import_batch_id, moveSeq, sideSeq }
  const last = new Map();
  const rows = db.prepare(
    "SELECT id, entity_id, new_values FROM audit_logs WHERE entity_type = 'asset' AND action IN ('create','update') AND entity_id IS NOT NULL ORDER BY id",
  ).iterate();
  for (const r of rows) {
    if (!assets.has(r.entity_id)) continue; // 삭제된 자산
    let nv;
    try { nv = JSON.parse(r.new_values || "{}"); } catch { continue; }
    if (!nv || typeof nv !== "object") continue;
    const s = last.get(r.entity_id) || { moveSeq: 0, sideSeq: 0 };
    if ("team_id" in nv) s.team_id = nv.team_id;
    if ("import_batch_id" in nv) s.import_batch_id = nv.import_batch_id;
    if ("verified_at" in nv) s.verified = { at: nv.verified_at, by: nv.verified_by };
    if ("rack_side" in nv) { s.rack_side = nv.rack_side; s.sideSeq = r.id; }
    // 위치 이동 기록: rack_id/rack_unit_start 가 이 행에서 바뀐 경우(update 는 변경 필드만 남는다)
    if (("rack_id" in nv || "rack_unit_start" in nv) && !("rack_side" in nv)) s.moveSeq = r.id;
    last.set(r.entity_id, s);
  }

  const plan = [];
  for (const [id, s] of last) {
    const a = assets.get(id);
    const set = {};
    const team = Number(s.team_id);
    if (a.team_id == null && Number.isInteger(team) && team > 0 && teams.has(team)) set.team_id = team;
    if (a.rack_side == null && (s.rack_side === "L" || s.rack_side === "R") && s.sideSeq > s.moveSeq && a.rack_id != null) set.rack_side = s.rack_side;
    if (empty(a.verified_at) && s.verified && !empty(s.verified.at)) {
      set.verified_at = String(s.verified.at);
      if (empty(a.verified_by) && !empty(s.verified.by)) set.verified_by = String(s.verified.by);
    }
    if (empty(a.import_batch_id) && !empty(s.import_batch_id)) set.import_batch_id = String(s.import_batch_id);
    if (Object.keys(set).length) plan.push({ id, asset_name: a.asset_name, set });
  }
  return plan.sort((x, y) => x.id - y.id);
}

/** 계획 적용 — 단일 트랜잭션, 자산별 감사로그 1행. 반환: 적용 건수 */
function applyRestore(db, plan) {
  const audit = db.prepare(
    `INSERT INTO audit_logs (entity_type, entity_id, entity_name, action, changed_by, changed_fields, old_values, new_values)
     VALUES ('asset', ?, ?, 'update', ?, ?, ?, ?)`,
  );
  let n = 0;
  db.transaction(() => {
    for (const p of plan) {
      const cols = Object.keys(p.set);
      // 계획 이후 값이 생겼으면 건드리지 않는다(조건부 UPDATE — 현재 값이 비었을 때만)
      const guard = cols.map((c) => (c === "team_id" || c === "rack_side" ? `${c} IS NULL` : `COALESCE(${c},'') = ''`)).join(" AND ");
      const res = db.prepare(`UPDATE assets SET ${cols.map((c) => `${c} = @${c}`).join(", ")} WHERE id = @id AND ${guard}`).run({ ...p.set, id: p.id });
      if (res.changes !== 1) continue;
      audit.run(p.id, p.asset_name, ACTOR, JSON.stringify(cols),
        JSON.stringify(Object.fromEntries(cols.map((c) => [c, null]))),
        JSON.stringify({ ...p.set, _cause: CAUSE }));
      n++;
    }
  })();
  return n;
}

function summarize(plan) {
  const by = {};
  for (const p of plan) for (const c of Object.keys(p.set)) by[c] = (by[c] || 0) + 1;
  return by;
}

module.exports = { planRestore, applyRestore, summarize };

if (require.main === module) {
  const APP = process.env.APP_DIR || "/opt/asset-inventory";
  const DB_PATH = process.env.ASSET_DB_PATH || path.join(APP, "data.db");
  const apply = process.argv.includes("--apply");
  let Database;
  for (const p of [path.join(APP, ".next/standalone/node_modules/better-sqlite3"), path.join(APP, "node_modules/better-sqlite3"), "better-sqlite3"]) {
    try { Database = require(p); break; } catch { /* 다음 후보 */ }
  }
  if (!Database) { console.error(`[restore] better-sqlite3 로드 실패 — APP_DIR(${APP}) 확인`); process.exit(1); }
  let db;
  try {
    db = new Database(DB_PATH, { fileMustExist: true, readonly: !apply });
  } catch (e) {
    console.error(`[restore] DB 열기 실패: ${DB_PATH} — ${e.message}`);
    process.exit(1);
  }
  try {
    const cols = new Set(db.prepare("PRAGMA table_info(assets)").all().map((c) => c.name));
    const missing = ["team_id", "rack_side", "verified_at", "verified_by", "import_batch_id"].filter((c) => !cols.has(c));
    if (missing.length) {
      console.error(`[restore] assets 컬럼 없음: ${missing.join(", ")} — 새 판으로 1회 기동(마이그레이션) 후 실행하세요`);
      process.exit(1);
    }
    db.pragma("busy_timeout = 5000");
    const plan = planRestore(db);
    const by = summarize(plan);
    console.log(`[restore] 복구 대상 자산 ${plan.length}건  ${Object.entries(by).map(([k, v]) => `${k}:${v}`).join("  ") || ""}`);
    for (const p of plan.slice(0, 15)) console.log(`  #${p.id} ${p.asset_name}  ${JSON.stringify(p.set)}`);
    if (plan.length > 15) console.log(`  … 외 ${plan.length - 15}건`);
    if (!apply) {
      if (plan.length) console.log("[restore] 미리보기입니다. 적용: --apply (서비스 중지 상태에서)");
    } else if (plan.length) {
      const n = applyRestore(db, plan);
      console.log(`[restore] 적용 ${n}건 — 감사로그에 '${ACTOR}' 로 기록`);
    }
  } catch (e) {
    console.error(`[restore] 실패: ${e.message}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

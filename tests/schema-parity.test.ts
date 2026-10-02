// tests/schema-parity.test.ts — "어떤 경로로 만들어진 DB 든 getDb() 를 거치면 같은 스키마" 불변식.
//
// 운영 DB 는 setup 의 db-seed.mjs(구버전 DDL) 로 태어나 getDb() 마이그레이션으로 현행화된다.
// 신규 DB 는 getDb() 의 CREATE TABLE 로 태어난다. 두 경로의 스키마가 갈라지면 운영에서만 터진다
// (실례: 재빌드형 마이그레이션이 assets.import_batch_id 를 탈락 → 엑셀 일괄등록 500).
// 컬럼·타입·NOT NULL·DEFAULT·PK·FK(ON DELETE)·CHECK·UNIQUE·인덱스·트리거·뷰를 전부 비교한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

type Schema = {
  user_version: number;
  tables: Record<string, { cols: string[]; fks: string[]; checks: string[]; constraints: string[] }>;
  indexes: Record<string, string>;
  triggers: Record<string, string>;
  views: Record<string, string>;
};

const ROOT = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "asset-parity-"));
const env = (db: string): NodeJS.ProcessEnv => ({ ...process.env, ASSET_DB_PATH: db, NODE_ENV: "test" });

function dump(db: string): Schema {
  const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "tests/fixtures/schema-dump.mjs")], {
    cwd: ROOT, env: env(db), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 << 20,
  });
  return JSON.parse(out) as Schema;
}

// 서버 1회 기동(getDb) + 선택적 쓰기/조회 — tests/fixtures/db-boot.mjs
function boot(db: string, sql = "", query = ""): { rows: Record<string, unknown>[]; rootpages: Record<string, number> } {
  const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "tests/fixtures/db-boot.mjs")], {
    cwd: ROOT, env: { ...env(db), BOOT_SQL: sql, BOOT_QUERY: query }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

function seed(db: string, extra: Record<string, string> = {}) {
  execFileSync(process.execPath, [join(ROOT, "scripts/db-seed.mjs")], { cwd: ROOT, env: { ...env(db), ...extra }, stdio: "ignore" });
}

// 차이를 사람이 읽을 수 있는 목록으로 — 실패 메시지에 그대로 노출
function diff(a: Schema, b: Schema): string[] {
  const out: string[] = [];
  const cmp = (label: string, x: string[], y: string[]) => {
    const X = new Set(x), Y = new Set(y);
    for (const v of x) if (!Y.has(v)) out.push(`${label} 누락: ${v}`);
    for (const v of y) if (!X.has(v)) out.push(`${label} 추가: ${v}`);
  };
  if (a.user_version !== b.user_version) out.push(`user_version ${a.user_version} ≠ ${b.user_version}`);
  cmp("table", Object.keys(a.tables), Object.keys(b.tables));
  for (const t of Object.keys(a.tables)) {
    if (!b.tables[t]) continue;
    for (const k of ["cols", "fks", "checks", "constraints"] as const) cmp(`${t}.${k}`, a.tables[t][k], b.tables[t][k]);
  }
  for (const k of ["indexes", "triggers", "views"] as const) {
    cmp(k, Object.entries(a[k]).map(([n, s]) => `${n} ${s}`), Object.entries(b[k]).map(([n, s]) => `${n} ${s}`));
  }
  return out;
}

let fresh: Schema;
before(() => { fresh = dump(join(dir, "fresh.db")); });
after(() => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); } catch { /* Windows WAL 잠금 잔여 */ } });

test("신규 DB 스키마가 비어 있지 않다 (덤프 자체 검증)", () => {
  assert.ok(Object.keys(fresh.tables).length >= 25, `테이블 ${Object.keys(fresh.tables).length}개`);
  assert.ok(fresh.tables.assets.cols.some((c) => c.startsWith("import_batch_id ")));
  assert.ok(Object.keys(fresh.indexes).length > 0);
});

test("db-seed(전체 데모) → getDb 마이그레이션 = 신규 DB 스키마", () => {
  const db = join(dir, "seeded.db");
  seed(db);
  assert.deepEqual(diff(fresh, dump(db)), []);
});

test("db-seed(SEED_MINIMAL — 실서버 설치 경로) → getDb 마이그레이션 = 신규 DB 스키마", () => {
  const db = join(dir, "minimal.db");
  seed(db, { SEED_MINIMAL: "1" });
  assert.deepEqual(diff(fresh, dump(db)), []);
});

test("마이그레이션은 멱등 — 두 번째 기동에서 스키마가 바뀌지 않는다", () => {
  const db = join(dir, "seeded.db");
  const first = dump(db);
  assert.deepEqual(diff(first, dump(db)), []);
});

// 회귀(2026-10-01): 'vm' 재빌드 게이트가 DDL 문자열 "'vm'" 유무였는데, asset_type CHECK 해제 이후 항상 참 →
//   매 기동 assets 재생성. 스키마는 같아 보여도(뒤에서 ALTER 로 다시 생김) 값이 매번 사라졌다.
test("두 번째 기동부터는 어떤 테이블도 재생성되지 않는다 (재빌드 게이트 수렴)", () => {
  for (const name of ["fresh-boot.db", "seed-boot.db"]) {
    const db = join(dir, name);
    if (name.startsWith("seed")) seed(db);
    const first = boot(db).rootpages;
    const second = boot(db).rootpages;
    const rebuilt = Object.keys(first).filter((t) => first[t] !== second[t]);
    assert.deepEqual(rebuilt, [], `${name}: 재기동마다 재생성되는 테이블`);
  }
});

test("뒤늦게 추가된 컬럼의 값이 재기동 후에도 보존된다 (소유팀·랙 L/R·배치·현행화 도장·사용자 보안 설정)", () => {
  const db = join(dir, "survive.db");
  seed(db);
  boot(db, `
    INSERT INTO teams (team_name) VALUES ('생존팀');
    UPDATE assets SET team_id = (SELECT id FROM teams WHERE team_name='생존팀'), rack_side = 'R',
      import_batch_id = 'up-1', verified_at = '2026-10-01 09:00:00', verified_by = 'tester', network_zone = '업무망', cia_c = 3
      WHERE id = (SELECT MIN(id) FROM assets);
    UPDATE users SET allowed_ips = '10.0.0.0/8', must_change_password = 1, totp_enabled = 1, token_version = 7
      WHERE username = 'admin@example.go.kr';
  `);
  const q = `SELECT
    (SELECT json_object('team', t.team_name, 'side', a.rack_side, 'batch', a.import_batch_id, 'vat', a.verified_at, 'vby', a.verified_by, 'zone', a.network_zone, 'c', a.cia_c)
       FROM assets a LEFT JOIN teams t ON t.id = a.team_id WHERE a.id = (SELECT MIN(id) FROM assets)) AS asset,
    (SELECT json_object('ips', allowed_ips, 'mcp', must_change_password, 'totp', totp_enabled, 'tv', token_version)
       FROM users WHERE username = 'admin@example.go.kr') AS usr`;
  for (let i = 0; i < 2; i++) {
    const r = boot(db, "", q).rows[0] as { asset: string; usr: string };
    assert.deepEqual(JSON.parse(r.asset), { team: "생존팀", side: "R", batch: "up-1", vat: "2026-10-01 09:00:00", vby: "tester", zone: "업무망", c: 3 }, `재기동 ${i + 1}회차 자산 값 유실`);
    assert.deepEqual(JSON.parse(r.usr), { ips: "10.0.0.0/8", mcp: 1, totp: 1, tv: 7 }, `재기동 ${i + 1}회차 사용자 값 유실`);
  }
});

test("db-seed 는 사용자가 있는 DB 를 거부한다 (운영 DB 전체 DROP 방지)", () => {
  const db = join(dir, "seeded.db");
  const count = () => {
    const c = new Database(db, { readonly: true });
    try { return c.prepare("SELECT (SELECT COUNT(*) FROM users) AS u, (SELECT COUNT(*) FROM assets) AS a").get() as { u: number; a: number }; }
    finally { c.close(); }
  };
  const before = count();
  assert.ok(before.u > 0 && before.a > 0);
  assert.throws(() => seed(db), (e: { status?: number }) => e.status === 2);
  assert.deepEqual(count(), before, "거부 후에도 데이터가 그대로여야 한다");
});

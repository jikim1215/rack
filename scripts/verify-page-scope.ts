// G003 (P2) page-level scope scanner — closes the verification blind spot (architect F3):
// Next.js server-component PAGES query the DB directly; any page that selects from an
// asset-bearing table (assets / asset_movements / maintenance_logs / asset_ips) MUST apply
// row-level scopeWhere, OR be strictly admin-only (admin=총괄=전역 스코프, scopeWhere→1=1).
// This flags any asset-bearing query that is neither scoped nor admin-guarded.
//
// Run: node --experimental-strip-types scripts/verify-page-scope.ts
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const root = "src/app";

// asset-bearing tables: selecting/joining these exposes per-asset identity and must be scoped
const ASSET_TABLE = /\b(from|join)\s+(assets|asset_movements|maintenance_logs|asset_ips)\b/gi;
const HAS_SCOPE = /scopeWhere|scope\.sql|scope[A-Za-z]*\.sql/;

// 한 자산쿼리 발생 위치(idx)가 admin 전용으로 보호되는지 — 발생 위치 기준 정밀 판정.
// (architect stage-15 MEDIUM: ternary가 consequent를 실제로 감싸야 false-negative 방지)
function adminGuardedAt(src: string, idx: number): boolean {
  const before = src.slice(0, idx);
  // (a) 페이지 전역 redirect 게이트: role!=='admin' 직후 redirect()/notFound() — 이후 모든 쿼리를 지배
  if (/role\s*!==?\s*["']admin["'][\s\S]{0,160}?(redirect|notFound)\s*\(/.test(before)) return true;
  // (b) admin 삼항 consequent 내부: 직전 `role==='admin' ?` 이후 idx 사이에 삼항 분기 구분자(`: []`, `) :`, `] :`)가 없으면 consequent 안.
  const terns = [...before.matchAll(/role\s*===?\s*["']admin["']\s*\?/g)];
  if (terns.length) {
    const tpos = terns[terns.length - 1]!.index!;
    const between = src.slice(tpos, idx);
    if (!/:\s*\[\]/.test(between) && !/\)\s*:\s/.test(between) && !/\]\s*:\s/.test(between)) return true;
  }
  return false;
}

// 페이지가 안전한가: 자산쿼리가 없거나, scopeWhere를 쓰거나, 모든 자산쿼리가 admin-guarded.
function classifyPage(src: string): { verdict: "n/a" | "scoped" | "admin" | "leak" } {
  const matches = [...src.matchAll(ASSET_TABLE)];
  if (matches.length === 0) return { verdict: "n/a" };
  if (HAS_SCOPE.test(src)) return { verdict: "scoped" };
  const allAdmin = matches.every(m => adminGuardedAt(src, m.index!));
  return { verdict: allAdmin ? "admin" : "leak" };
}

// ── 음성 픽스처 자기검증 (architect stage-15: negative fixture) ──
function selfTest() {
  const cases: Array<{ name: string; src: string; want: string }> = [
    { name: "scoped page", src: `const w=scopeWhere(a,'team_id'); db.prepare('SELECT * FROM assets WHERE '+w.sql)`, want: "scoped" },
    { name: "admin redirect-gate", src: `if(session.role!=='admin'){redirect('/')}\ndb.prepare('SELECT * FROM assets')`, want: "admin" },
    { name: "admin ternary wrapping query", src: `const t = role==='admin' ? db.prepare('SELECT COUNT(*) FROM assets a WHERE a.team_id=t.id').all() : [];`, want: "admin" },
    { name: "admin ternary + SEPARATE unguarded query (real leak)", src: `const u = role==='admin' ? db.prepare('SELECT id FROM users').all() : [];\nconst leak = db.prepare('SELECT * FROM assets').all();`, want: "leak" },
    { name: "plain unguarded asset query", src: `const x = db.prepare('SELECT * FROM asset_ips').all();`, want: "leak" },
  ];
  let ok = true;
  for (const c of cases) {
    const got = classifyPage(c.src).verdict;
    if (got !== c.want) { console.error(`SELFTEST FAIL: ${c.name} → got '${got}', want '${c.want}'`); ok = false; }
    else console.log(`selftest ok: ${c.name} → ${got}`);
  }
  if (!ok) { console.error("PAGE-SCOPE SELFTEST FAILED"); process.exit(2); }
}
selfTest();

const pages: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e === "page.tsx") pages.push(p);
  }
})(root);

const flagged: string[] = [];
for (const f of pages.sort()) {
  const src = readFileSync(f, "utf8");
  const rel = f.replace(/\\/g, "/").replace(root + "/", "");
  const { verdict } = classifyPage(src);
  if (verdict === "n/a") console.log(`n/a    ${rel} (no asset-bearing query)`);
  else if (verdict === "scoped") console.log(`SCOPED ${rel}`);
  else if (verdict === "admin") console.log(`ADMIN  ${rel} (admin-only gated; admin=global scope)`);
  else { console.log(`LEAK!  ${rel} (asset-bearing query without scopeWhere or admin gate)`); flagged.push(rel); }
}

console.log(`\npages=${pages.length} flagged=${flagged.length}`);
if (flagged.length) { console.error("LEAKING PAGES:\n" + flagged.join("\n")); process.exit(1); }
console.log("PAGE-SCOPE OK: every asset-bearing server page applies scopeWhere or is admin-only gated");

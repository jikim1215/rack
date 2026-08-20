// G003 (P2) RBAC row-level authorization matrix harness.
// Drives the REAL src/lib/authz.ts (scopeWhere / assertCan*) — never re-implements
// the policy — and asserts every (role × target × action) cell against the
// independently-declared ADR-007/009/010 expectation. Any mismatch (leak or
// over-deny) fails the gate with a nonzero exit.
//
// Run: node scripts/test-authz-matrix.mjs
//
// authz.ts only has type-only imports ("import type … from @/lib/auth"), so under
// Node's type-stripping it loads with no alias/runtime resolution. Node 22 needs
// the --experimental-strip-types flag, so this script re-execs itself with it once
// (writing the stripped module nowhere — the loader strips in-memory).
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

// ── ensure we run under type-stripping so we can import the .ts source directly ──
if (!process.env.__AUTHZ_MATRIX_CHILD) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url)],
    { stdio: "inherit", env: { ...process.env, __AUTHZ_MATRIX_CHILD: "1" } },
  );
  process.exit(r.status ?? 1);
}

const AUTHZ_TS = join(process.cwd(), "src", "lib", "authz.ts");
const { actorFromSession, scopeWhere, assertCanWrite, assertCanDelete, assertCanDownload } =
  await import(pathToFileURL(AUTHZ_TS).href);

// ── actors (built through the real actorFromSession from session-shaped input) ──
const ACTORS = [
  { key: "admin",       session: { userId: 1, username: "admin", role: "admin",  teamId: null } },
  { key: "team#1",      session: { userId: 2, username: "t1",    role: "team",   teamId: 1 } },
  { key: "team#null",   session: { userId: 3, username: "t0",    role: "team",   teamId: null } },
  { key: "viewer",      session: { userId: 4, username: "view",  role: "viewer", teamId: null } },
  { key: "unauth",      session: null },
];

// ── targets: a row's team_id (own=1, other=2, unassigned=null) ──
const TARGETS = [
  { key: "own(1)",        teamId: 1 },
  { key: "other(2)",      teamId: 2 },
  { key: "unassigned(∅)", teamId: null },
];

const ACTIONS = ["read", "write", "delete", "download"];

// ── evaluate a scopeWhere clause against a concrete row team_id ──
// scopeWhere emits exactly one of: "(1 = 1)" allow-all, "(1 = 0)" deny-all,
// or "(<col> = ?)" with params=[teamId].
function rowVisible(scope, rowTeamId) {
  if (scope.sql === "(1 = 1)") return true;
  if (scope.sql === "(1 = 0)") return false;
  return scope.params.length === 1 && rowTeamId === scope.params[0];
}

// ── ACTUAL behavior, computed only from the real authz.ts exports ──
function actual(actor, rowTeamId, action) {
  switch (action) {
    case "read": {
      const scope = scopeWhere(actor, "team_id");
      return rowVisible(scope, rowTeamId);
    }
    case "download": {
      // export = download permission AND row in read-scope
      try { assertCanDownload(actor); } catch { return false; }
      return rowVisible(scopeWhere(actor, "team_id"), rowTeamId);
    }
    case "write": {
      try { assertCanWrite(actor, rowTeamId); return true; } catch { return false; }
    }
    case "delete": {
      try { assertCanDelete(actor, rowTeamId); return true; } catch { return false; }
    }
    default:
      throw new Error(`unknown action ${action}`);
  }
}

// ── EXPECTED policy, declared independently of the library (the spec, in code) ──
// ADR-007 default-deny · ADR-009 team_id owns · ADR-010 viewer read+download all,
// no write/delete.
function expected(actorKey, rowTeamId, action) {
  if (actorKey === "unauth") return false;            // 미인증 → 전부 거부
  if (actorKey === "admin") return true;              // 총괄 → 전부 허용
  if (actorKey === "viewer") {                        // 전체열람 → 읽기/다운로드만
    return action === "read" || action === "download";
  }
  if (actorKey === "team#null") return false;         // 팀 미배정 → 전부 거부
  if (actorKey === "team#1") {
    const own = rowTeamId === 1;                       // 자기 팀(1) 소유 행만
    return own; // read/write/delete/download 모두 자기 팀 행에 한해 허용
  }
  throw new Error(`unknown actor ${actorKey}`);
}

// ── run the full matrix ──
const results = [];
for (const a of ACTORS) {
  const actor = actorFromSession(a.session);
  for (const t of TARGETS) {
    for (const action of ACTIONS) {
      const exp = expected(a.key, t.teamId, action);
      const act = actual(actor, t.teamId, action);
      results.push({ actor: a.key, target: t.key, action, exp, act, pass: exp === act });
    }
  }
}

// ── deterministic table ──
const pad = (s, n) => String(s).padEnd(n);
const ACT_W = 10, TGT_W = 14, ACTION_W = 9;
console.log("ROLE × TARGET × ACTION authorization matrix (E=expected, A=actual)");
console.log(
  pad("ROLE", ACT_W) + pad("TARGET", TGT_W) + pad("ACTION", ACTION_W) +
  pad("EXP", 6) + pad("ACT", 6) + "RESULT",
);
console.log("-".repeat(ACT_W + TGT_W + ACTION_W + 6 + 6 + 6));
for (const r of results) {
  console.log(
    pad(r.actor, ACT_W) + pad(r.target, TGT_W) + pad(r.action, ACTION_W) +
    pad(r.exp ? "allow" : "deny", 6) + pad(r.act ? "allow" : "deny", 6) +
    (r.pass ? "PASS" : "FAIL"),
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} cells passed`);
if (failed.length) {
  console.error(`${failed.length} FAILED:`);
  for (const r of failed) {
    console.error(`  ${r.actor} × ${r.target} × ${r.action}: expected ${r.exp ? "allow" : "deny"}, got ${r.act ? "allow" : "deny"}`);
  }
  console.error("AUTHZ MATRIX: FAIL");
  process.exit(1);
}
console.log("AUTHZ MATRIX: PASS");

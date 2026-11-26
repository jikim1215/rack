// Windows 번들 실기동 검증 — zip 을 임시 폴더에 풀어 번들 Node 로 start(첫 실행: .env·DB 생성) → /api/health 200
// → 초기 총괄 계정 로그인 → backup 까지 실제로 돌려 본다. Release CI 가 bundle-windows 마지막에 실행한다.
// 환경변수로 앱 설정(ASSET_DB_PATH 등)을 일부러 걸어 둔다 — 실행기가 .env 만 쓰는지 확인(개발 PC 의 DB 를 건드리지 않게).
// 사용: node scripts/deploy/windows/verify-bundle.mjs [dist/asset-inventory-windows-v<버전>.zip]
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const ZIP = resolve(process.argv[2] || join(ROOT, "dist", `asset-inventory-windows-v${VERSION}.zip`));
const SUMS = join(dirname(ZIP), `SHA256SUMS-windows-v${VERSION}.txt`);
const TAR = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
const PORT = String(40000 + Math.floor(Math.random() * 20000));
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
const check = (cond, name, detail = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`── Windows 번들 검증: ${ZIP} ──`);
if (!existsSync(ZIP)) { console.error(`zip 없음: ${ZIP}`); process.exit(1); }
const hash = createHash("sha256").update(readFileSync(ZIP)).digest("hex");
check(existsSync(SUMS) && readFileSync(SUMS, "utf8") === `${hash}  ${basename(ZIP)}\n`, "체크섬 파일 일치", SUMS);

const tmp = mkdtempSync(join(tmpdir(), "asset-win-verify-"));
const APP = join(tmp, "asset-inventory");
let child;
try {
  const x = spawnSync(TAR, ["-xf", ZIP, "-C", tmp], { stdio: "inherit" });
  if (x.status !== 0) throw new Error(`압축 해제 실패(exit ${x.status})`);

  const ver = readFileSync(join(APP, "VERSION"), "utf8");
  check(ver.includes(`version=${VERSION}\n`), `VERSION = ${VERSION}`, ver.trim());
  for (const f of [
    "start.cmd", "backup.cmd", "README-windows.txt", "node/node.exe", "scripts/db-seed.mjs",
    "scripts/deploy/windows/start.mjs", "scripts/deploy/server-tls.mjs", ".next/standalone/server.js",
    ".next/standalone/node_modules/better-sqlite3/build/Release/better_sqlite3.node", "docs/사용자매뉴얼.md",
  ]) check(existsSync(join(APP, f)), `구성: ${f}`);
  const leaked = readdirSync(APP, { recursive: true }).filter((p) => /(^|[\\/])(\.env(\..*)?|[^\\/]*\.db(-wal|-shm)?)$/.test(p));
  check(leaked.length === 0, "번들에 .env/*.db 잔재 없음", leaked.join(", "));

  // 첫 실행 — 실제 사용자와 같은 경로(번들 Node + 실행기). 앱 설정 환경변수를 일부러 걸어
  // 실행기가 .env 만 쓰는지도 확인한다(새면 이 DB·포트로 가 등록·기동이 어긋난다).
  const NODE = join(APP, "node", "node.exe");
  const START = join(APP, "scripts", "deploy", "windows", "start.mjs");
  const decoy = { ...process.env, ASSET_DB_PATH: join(tmp, "decoy.db"), AUTH_SECRET: "decoy", PORT: "1", HOSTNAME: "0.0.0.0" };
  const ini = spawnSync(NODE, [START, "init"], { cwd: APP, env: decoy, encoding: "utf8" });
  check(ini.status === 0, "init(첫 실행: .env·DB 생성)", `${ini.stdout}${ini.stderr}`.trim());
  const envText = readFileSync(join(APP, ".env"), "utf8");
  check(/^AUTH_SECRET=[0-9a-f]{96}$/m.test(envText) && /^HOSTNAME=127\.0\.0\.1$/m.test(envText), ".env 생성(무작위 AUTH_SECRET, 127.0.0.1)");
  check(existsSync(join(APP, "data.db")) && !existsSync(decoy.ASSET_DB_PATH), "data.db 는 번들 폴더에(PC 환경변수 무시)");
  writeFileSync(join(APP, ".env"), envText.replace(/^PORT=\d+$/m, `PORT=${PORT}`));

  child = spawn(NODE, [START, "start"], { cwd: APP, env: decoy, stdio: ["ignore", "inherit", "inherit"] });
  let exited = null;
  child.on("exit", (code) => { exited = code; });

  let health = null;
  for (let i = 0; i < 90 && exited === null; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      health = { status: r.status, body: await r.json() };
      if (r.status === 200) break;
    } catch { /* 기동 중 */ }
    await sleep(1000);
  }
  check(health?.status === 200 && health.body.ok === true, "/api/health 200 ok", JSON.stringify(health) + (exited !== null ? ` (실행기 종료 ${exited})` : ""));

  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin@example.go.kr", password: createHash("sha512").update("admin123").digest("hex") }),
  });
  const cookie = lr.headers.get("set-cookie") || "";
  check(lr.status === 200 && cookie.length > 0 && !/;\s*secure/i.test(cookie), "초기 총괄 로그인(HTTP, Secure 아닌 세션 쿠키)", `status ${lr.status} cookie=${cookie.slice(0, 60)}`);

  const b = spawnSync(NODE, [START, "backup"], { cwd: APP, env: decoy, encoding: "utf8" });
  const backups = existsSync(join(APP, "backups")) ? readdirSync(join(APP, "backups")).filter((f) => /^data-\d{8}_\d{6}\.db$/.test(f)) : [];
  check(b.status === 0 && backups.length === 1, "backup(실행 중 온라인 백업)", `${b.stdout}${b.stderr}`.trim());
} catch (e) {
  failures++;
  console.error(`  ✗ ${e.message}`);
} finally {
  if (child?.pid && child.exitCode === null) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  await sleep(1000);
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
console.log(failures ? `✗ 실패 ${failures}건` : "✓ Windows 번들 검증 통과");
process.exit(failures ? 1 : 0);

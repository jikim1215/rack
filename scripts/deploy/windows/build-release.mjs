// asset-inventory Windows 번들러 — Windows x64 에서 실행해 Windows 용 오프라인 번들을 만든다.
// 산출물: dist/asset-inventory-windows-v<버전>.zip + dist/SHA256SUMS-windows-v<버전>.txt
//   zip 안 asset-inventory\ : start.cmd · backup.cmd · README-windows.txt · VERSION · node\node.exe(번들 Node 22)
//                             · .next\standalone(앱 + win32-x64 better-sqlite3) · scripts(db-seed·smoke·server-tls·실행기) · docs
// 전제: 이 스크립트를 실행하는 Node 가 번들할 Node 와 같은 22.x (better-sqlite3 native ABI 일치),
//       NODE_ZIP(기본 vendor/node-win-x64.zip) = nodejs.org 의 node-v22.x.y-win-x64.zip (SHA256 검증은 호출자 몫 — Release CI).
// Linux(Rocky 8.10) 번들은 scripts/deploy/build-release.sh — 버전 메타·Node 하한(NODE_MIN)은 그쪽과 같은 값을 쓴다.
// 사용: node scripts/deploy/windows/build-release.mjs
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuildMeta } from "../../build-meta.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HERE = join(ROOT, "scripts", "deploy", "windows");
const DIST = join(ROOT, "dist");
const WORK = join(DIST, "windows");
const STAGE = join(WORK, "asset-inventory");
const SA = join(STAGE, ".next", "standalone");
const NODE_ZIP = resolve(ROOT, process.env.NODE_ZIP || "vendor/node-win-x64.zip");
// Windows 내장 bsdtar(zip 읽기 지원). Git for Windows 의 GNU tar 가 PATH 앞에 있어도 이것을 쓴다.
const TAR = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");

function die(msg) {
  console.error(`[ERROR] ${msg}`);
  process.exit(1);
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (r.status !== 0) die(`실패(exit ${r.status ?? r.error?.message}): ${cmd} ${args.join(" ")}`);
  return r;
}
function capture(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) die(`실패(exit ${r.status ?? r.error?.message}): ${cmd} ${args.join(" ")}\n${r.stderr}`);
  return r.stdout;
}
/** "22.23.4" 비교 — a >= b */
function versionAtLeast(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return true;
}

console.log("== Windows 오프라인 번들 빌드 (win32-x64) ==");

// ── 0. 환경 검증 ──
if (process.platform !== "win32" || process.arch !== "x64") die(`Windows x64 에서 실행해야 합니다 (현재 ${process.platform}-${process.arch})`);
if (!existsSync(TAR)) die(`Windows 내장 tar 없음: ${TAR}`);
const NODE_MIN = /^NODE_MIN="([0-9.]+)"$/m.exec(readFileSync(join(ROOT, "scripts", "deploy", "build-release.sh"), "utf8"))?.[1];
if (!NODE_MIN) die("scripts/deploy/build-release.sh 에서 NODE_MIN 을 찾지 못했습니다");
if (!existsSync(NODE_ZIP)) die(`번들 Node 없음: ${NODE_ZIP} (node-v${NODE_MIN}+ win-x64 zip)`);
const nodeDir = capture(TAR, ["-tf", NODE_ZIP]).split(/\r?\n/)[0].split("/")[0]; // node-v22.23.5-win-x64
const bundled = /^node-v(\d+\.\d+\.\d+)-win-x64$/.exec(nodeDir)?.[1];
if (!bundled) die(`Node zip 형식이 아님(최상위 ${nodeDir}): ${NODE_ZIP}`);
console.log(`[INFO] 번들 Node v${bundled} (하한 v${NODE_MIN}) · 빌드 Node ${process.version}`);
if (bundled.split(".")[0] !== NODE_MIN.split(".")[0] || !versionAtLeast(bundled, NODE_MIN)) {
  die(`번들 Node v${bundled} — v${NODE_MIN} 이상(같은 ${NODE_MIN.split(".")[0]}.x)이 필요합니다(보안 패치 미반영)`);
}
if (process.versions.node.split(".")[0] !== bundled.split(".")[0]) {
  die(`빌드 Node ${process.version} 와 번들 Node v${bundled} 의 주 버전이 다르다 — better-sqlite3 native ABI 불일치`);
}

// ── 1. 클린 빌드 ──
rmSync(join(ROOT, ".next"), { recursive: true, force: true });
rmSync(WORK, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
// npm 은 .cmd — Node 22 는 .cmd 를 셸 없이 실행하지 않는다
run("npm ci --no-audit --no-fund", [], { shell: true });
const meta = resolveBuildMeta({ root: ROOT });
const buildEnv = { ...process.env, APP_VERSION: meta.version, APP_COMMIT: meta.commit, APP_BUILT_AT: meta.builtAt, NEXT_TELEMETRY_DISABLED: "1" };
console.log(`[INFO] 버전 v${meta.version} · 커밋 ${meta.commit || "(없음)"} · 빌드 ${meta.builtAt}`);
if (meta.commit.endsWith("-dirty")) console.log("[WARN] 미커밋 변경이 있는 소스 — 정식 릴리스는 커밋·태그 후 다시 빌드");
run("npm run build", [], { shell: true, env: buildEnv });
if (!existsSync(join(ROOT, ".next", "standalone", "server.js"))) die("standalone 빌드 산출물 없음 (next.config output:'standalone' 확인)");

// ── 2. 스테이징 ──
writeFileSync(join(STAGE, "VERSION"), `version=${meta.version}\ncommit=${meta.commit}\nbuilt_at=${meta.builtAt}\n`);
cpSync(join(ROOT, ".next", "standalone"), SA, { recursive: true });
cpSync(join(ROOT, ".next", "static"), join(SA, ".next", "static"), { recursive: true });
if (existsSync(join(ROOT, "public"))) cpSync(join(ROOT, "public"), join(SA, "public"), { recursive: true });
// next 가 standalone 으로 잘못 트레이스한 개발 산출물 — 런타임은 참조하지 않는다(build-release.sh 와 같음)
rmSync(join(SA, "scripts"), { recursive: true, force: true });
// 앱은 standalone/node_modules/better-sqlite3 에서 native 를 로드한다 — 트레이싱이 놓쳤으면 명시 동봉
const SA_NATIVE = join(SA, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
if (!existsSync(SA_NATIVE)) {
  cpSync(join(ROOT, "node_modules", "better-sqlite3"), join(SA, "node_modules", "better-sqlite3"), { recursive: true });
}
if (!existsSync(SA_NATIVE)) die("better-sqlite3 native(win32-x64) 없음");

for (const f of ["db-seed.mjs", "smoke.mjs"]) cpSync(join(ROOT, "scripts", f), join(STAGE, "scripts", f));
cpSync(join(ROOT, "scripts", "deploy", "server-tls.mjs"), join(STAGE, "scripts", "deploy", "server-tls.mjs"));
cpSync(join(HERE, "start.mjs"), join(STAGE, "scripts", "deploy", "windows", "start.mjs"));
for (const f of ["start.cmd", "backup.cmd", "README-windows.txt"]) cpSync(join(HERE, f), join(STAGE, f));
// 문서는 저장소에 커밋된 것만 — 작업 PC 의 .gitignore 대상(망 구성 메모 등)이 섞이지 않게
for (const f of capture("git", ["-c", "safe.directory=*", "ls-files", "-z", "docs"]).split("\0").filter(Boolean)) {
  cpSync(join(ROOT, f), join(STAGE, f));
}

// 번들 Node — node.exe 와 라이선스만 (npm 등은 실행에 불필요)
const tmp = mkdtempSync(join(tmpdir(), "asset-node-"));
try {
  run(TAR, ["-xf", NODE_ZIP, "-C", tmp, `${nodeDir}/node.exe`, `${nodeDir}/LICENSE`]);
  mkdirSync(join(STAGE, "node"));
  for (const f of ["node.exe", "LICENSE"]) cpSync(join(tmp, nodeDir, f), join(STAGE, "node", f));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── 3. 빌드 잔재(.env / *.db) 제거 — dev 시크릿·DB 유출 금지 (build-release.sh 4-1 과 같은 규칙) ──
const PURGE = /^(\.env(\..*)?|.*\.db(-wal|-shm)?|.*\.db\.bak-.*)$/;
for (const e of readdirSync(STAGE, { recursive: true, withFileTypes: true })) {
  if (e.isFile() && PURGE.test(e.name)) {
    const p = join(e.parentPath, e.name);
    console.log(`[PURGE] ${p}`);
    rmSync(p);
  }
}

// ── 4. 번들 Node 로 native 로드 확인 ──
run(join(STAGE, "node", "node.exe"), [
  "-e",
  "const D=require(process.argv[1]);const d=new D(':memory:');d.prepare('select 1').get();d.close();console.log('[OK] 번들 Node '+process.version+' 로 better-sqlite3 로드')",
  join(SA, "node_modules", "better-sqlite3"),
]);

// ── 5. 패키징 — .NET ZipFile(비ASCII 파일명은 UTF-8 플래그, 경로 구분자 '/') ──
const ZIP_NAME = `asset-inventory-windows-v${meta.version}.zip`;
const SUMS_NAME = `SHA256SUMS-windows-v${meta.version}.txt`;
const ZIP = join(DIST, ZIP_NAME);
rmSync(ZIP, { force: true });
const ps = spawnSync("where", ["pwsh"], { stdio: "ignore" }).status === 0 ? "pwsh" : "powershell";
run(ps, [
  "-NoProfile", "-NonInteractive", "-Command",
  "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
    "[IO.Compression.ZipFile]::CreateFromDirectory($env:ZIP_SRC, $env:ZIP_DST, [IO.Compression.CompressionLevel]::Optimal, $true)",
], { env: { ...process.env, ZIP_SRC: STAGE, ZIP_DST: ZIP } });
const hash = createHash("sha256").update(readFileSync(ZIP)).digest("hex");
writeFileSync(join(DIST, SUMS_NAME), `${hash}  ${ZIP_NAME}\n`);
rmSync(WORK, { recursive: true, force: true });
console.log(`[OK] 릴리스: ${ZIP} (${(readFileSync(ZIP).length / 1048576).toFixed(1)}MB) — v${meta.version} (${meta.commit || "커밋 없음"})`);
console.log(`[OK] 체크섬: ${join(DIST, SUMS_NAME)}`);

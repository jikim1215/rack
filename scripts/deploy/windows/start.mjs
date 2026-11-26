// asset-inventory Windows 실행기 — 번들 최상위 start.cmd · backup.cmd 가 번들 Node(node\node.exe)로 부른다.
//   start  : init 후 앱 기동. Ctrl+C 로 종료.
//   init   : 처음이면 .env(무작위 AUTH_SECRET)와 data.db(최소 초기화 — 스키마 + 계정 3개)만 만든다. 이미 있으면 그대로 둔다.
//   backup : 실행 중에도 안전한 SQLite 온라인 백업 → backups\data-<시각>.db
// 앱 설정은 .env 하나뿐이다 — PC 에 걸린 환경변수(개발용 AUTH_SECRET·ASSET_DB_PATH 등)는 앱에 넘기지 않는다
// (Windows 기본 변수만 넘긴다). DB 는 .env 에 ASSET_DB_PATH 가 없으면 번들 폴더의 data.db — 폴더를 옮겨도 그대로 동작.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SA = join(APP, ".next", "standalone");
const ENV_FILE = join(APP, ".env");
// 앱 프로세스에 넘기는 Windows 기본 변수 — 나머지(앱 설정)는 .env 에서만
const SYSTEM_VARS = [
  "SystemRoot", "SystemDrive", "windir", "ComSpec", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "USERNAME",
  "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "COMPUTERNAME", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS",
];

function die(msg) {
  console.error(`[ERROR] ${msg}`);
  process.exit(1);
}

function ensureEnvFile() {
  if (existsSync(ENV_FILE)) return;
  const secret = randomBytes(48).toString("hex");
  const lines = [
    "# asset-inventory (Windows) 설정 — 바꾼 뒤 start.cmd 를 다시 실행. 앱은 이 파일의 값만 쓴다",
    "NODE_ENV=production",
    "NEXT_TELEMETRY_DISABLED=1",
    "# 세션 서명 키 — 바꾸면 모든 로그인이 풀린다. 외부에 노출 금지",
    `AUTH_SECRET=${secret}`,
    "# 접속 범위: 127.0.0.1 = 이 PC 에서만. 다른 PC 에서 접속하려면 0.0.0.0 + Windows 방화벽 인바운드 허용",
    "#   (사내망에 열 때는 아래 HTTPS 를 함께 켠다 — HTTP 는 비밀번호·세션이 평문으로 오간다)",
    "HOSTNAME=127.0.0.1",
    "PORT=3100",
    "TZ=Asia/Seoul",
    "# HTTP 접속이라 false. HTTPS(TLS_CERT_PATH·TLS_KEY_PATH)를 켜면 실행기가 true 로 바꾼다",
    "COOKIE_SECURE=false",
    "TRUST_PROXY=false",
    "# DB 위치(기본: 이 폴더의 data.db). 상대 경로는 이 폴더 기준",
    "# ASSET_DB_PATH=D:\\asset-data\\data.db",
    "# HTTPS: PEM 인증서·키 경로를 지정하면 Node TLS 종단으로 기동한다(HOSTNAME 무관, 모든 주소에서 수신).",
    "#   앱은 127.0.0.1:PORT 에 숨고 HTTPS_PORT 로 받으며 HTTP_PORT 는 HTTPS 로 301 넘긴다.",
    "# TLS_CERT_PATH=C:\\asset-inventory-tls\\cert.pem",
    "# TLS_KEY_PATH=C:\\asset-inventory-tls\\key.pem",
    "# HTTPS_PORT=443",
    "# HTTP_PORT=80",
    "",
  ];
  writeFileSync(ENV_FILE, lines.join("\r\n"), { encoding: "utf8", flag: "wx" });
  console.log(`[OK] 설정 파일 생성: ${ENV_FILE} (무작위 AUTH_SECRET)`);
}

/** Windows 기본 변수 + .env. ASSET_DB_PATH 는 절대 경로로 정규화. */
function appEnv() {
  const env = {};
  for (const k of SYSTEM_VARS) if (process.env[k] !== undefined) env[k] = process.env[k];
  Object.assign(env, parseEnv(readFileSync(ENV_FILE, "utf8")));
  if (!env.AUTH_SECRET) die(`.env 에 AUTH_SECRET 이 없습니다: ${ENV_FILE}`);
  env.ASSET_DB_PATH = env.ASSET_DB_PATH ? resolve(APP, env.ASSET_DB_PATH) : join(APP, "data.db");
  env.ASSET_DB_CWD = APP;
  return env;
}

/** DB 가 없으면 최소 초기화(scripts/db-seed.mjs SEED_MINIMAL=1). 만들었으면 true. */
function ensureDb(env) {
  const dbPath = env.ASSET_DB_PATH;
  if (existsSync(dbPath)) return false;
  mkdirSync(dirname(dbPath), { recursive: true });
  // db-seed 는 better-sqlite3 를 자기 위치 기준으로 찾는다 — 앱(standalone)의 native 를 쓰도록 그 안에서 실행
  const seed = join(SA, "db-seed.mjs");
  copyFileSync(join(APP, "scripts", "db-seed.mjs"), seed);
  const r = spawnSync(process.execPath, [seed], { cwd: SA, env: { ...env, SEED_MINIMAL: "1" }, stdio: "inherit" });
  rmSync(seed, { force: true });
  if (r.status !== 0) {
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(p, { force: true });
    die(`DB 최소 초기화 실패(exit ${r.status ?? r.error?.message ?? r.signal}) — ${dbPath}`);
  }
  console.log("[OK] DB 초기화 — 계정 admin@example.go.kr / admin123 (총괄), user@example.go.kr / user123, viewer@example.go.kr / viewer123");
  console.log("     첫 로그인 후 반드시 비밀번호를 바꾸고, 쓰지 않는 계정은 비활성화하세요.");
  return true;
}

function init() {
  ensureEnvFile();
  const env = appEnv();
  ensureDb(env);
  return env;
}

function start() {
  const env = init();
  let entry = join(SA, "server.js");
  const host = env.HOSTNAME === "0.0.0.0" ? "<이 PC 의 IP>" : env.HOSTNAME || "127.0.0.1";
  let url = `http://${host}:${env.PORT || 3000}`;
  if (env.TLS_CERT_PATH || env.TLS_KEY_PATH) {
    // server-tls.mjs 가 앱을 127.0.0.1:NEXT_INTERNAL_PORT 로 띄우고 COOKIE_SECURE=true 로 고정한다.
    // 앞단이 X-Real-IP/X-Forwarded-For 를 소켓 주소로 덮어쓰므로 TRUST_PROXY=true 가 안전하다.
    entry = join(APP, "scripts", "deploy", "server-tls.mjs");
    env.NEXT_INTERNAL_PORT = env.PORT || "3100";
    env.NEXT_SERVER = join(SA, "server.js");
    env.TRUST_PROXY = "true";
    const httpsPort = Number(env.HTTPS_PORT || 443);
    url = `https://<이 PC 의 주소>${httpsPort === 443 ? "" : `:${httpsPort}`}`;
  }
  console.log(`[INFO] DB: ${env.ASSET_DB_PATH}`);
  console.log(`[INFO] 접속: ${url}   (종료: Ctrl+C)`);
  const child = spawn(process.execPath, [entry], { cwd: APP, env, stdio: "inherit" });
  // Ctrl+C 는 콘솔의 모든 프로세스에 간다 — 앱이 스스로 끝나기를 기다렸다가 같은 코드로 종료
  process.on("SIGINT", () => {});
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

async function backup() {
  if (!existsSync(ENV_FILE)) die(`설정 파일 없음: ${ENV_FILE} — start.cmd 를 먼저 실행`);
  const dbPath = appEnv().ASSET_DB_PATH;
  if (!existsSync(dbPath)) die(`DB 없음: ${dbPath}`);
  const Database = createRequire(join(SA, "server.js"))("better-sqlite3");
  const dir = join(APP, "backups");
  mkdirSync(dir, { recursive: true });
  // KST yyyymmdd_hhmmss
  const ts = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(/[-:]/g, "").replace(" ", "_");
  const dest = join(dir, `data-${ts}.db`);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  console.log(`[OK] 백업: ${dest}`);
}

const cmd = process.argv[2] ?? "start";
if (cmd === "start") start();
else if (cmd === "init") init();
else if (cmd === "backup") await backup();
else die(`알 수 없는 명령: ${cmd} (start | init | backup)`);

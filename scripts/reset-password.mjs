// ── 계정 비밀번호 재설정 (비상용, 관리자매뉴얼 5.2-B) ──
// UI 로그인이 불가한 상황(유일한 admin 잠금/비번 분실)에서 해당 사용자 행만 안전하게 갱신한다.
// 테이블을 드롭하지 않는다 — db-seed.mjs 와 혼동 금지(그쪽은 전체 DROP).
//
// 사용: node scripts/reset-password.mjs <이메일> <새비밀번호>
//   예: node scripts/reset-password.mjs admin@example.go.kr "Asset!2026"
//   DB 경로는 .env 의 ASSET_DB_PATH, 없으면 ./data.db (ASSET_DB_PATH=... 로 덮어쓸 수 있음)
//
// 저장 규약(auth-core.ts 와 동일): `${salt}:${scrypt(sha512(평문), salt, N=16384,r=8,p=1)}`
// 부수효과: is_active=1, must_change_password=0, token_version+1(기존 세션 전부 무효), 해당 계정 로그인 잠금 해제.
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const [username, plain] = process.argv.slice(2);
if (!username || !plain) {
  console.error("사용법: node scripts/reset-password.mjs <이메일> <새비밀번호>");
  process.exit(1);
}

// 비밀번호 정책(auth-core.ts validatePasswordPolicy 와 동일): 8자 이상, 영문/숫자/특수 중 2종 이상
const classes = [/[a-zA-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(plain)).length;
if (plain.length < 8 || plain.length > 256 || classes < 2) {
  console.error("비밀번호 정책 위반: 8~256자, 영문/숫자/특수문자 중 2종 이상이어야 합니다.");
  process.exit(1);
}

// DB 경로: 환경변수 > .env 의 ASSET_DB_PATH > ./data.db
function dbPathFromEnvFile() {
  if (!existsSync(".env")) return null;
  const line = readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.trim().startsWith("ASSET_DB_PATH="));
  return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : null;
}
const dbPath = path.resolve(process.env.ASSET_DB_PATH || dbPathFromEnvFile() || "data.db");
if (!existsSync(dbPath)) {
  console.error(`DB 파일이 없습니다: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);
const pre = createHash("sha512").update(plain).digest("hex"); // 클라이언트 프리해시 규약
const salt = randomBytes(32).toString("hex");
const hash = scryptSync(pre, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");

const res = db
  .prepare(
    "UPDATE users SET password_hash = ?, is_active = 1, must_change_password = 0, token_version = token_version + 1 WHERE username = ?",
  )
  .run(`${salt}:${hash}`, username);

if (res.changes === 0) {
  const all = db.prepare("SELECT username, role, is_active FROM users ORDER BY id").all();
  console.error(`'${username}' 계정을 찾지 못했습니다. 현재 계정 목록:`);
  for (const u of all) console.error(`  - ${u.username} (${u.role}${u.is_active ? "" : ", 비활성"})`);
  process.exit(1);
}

const unlocked = db.prepare("DELETE FROM login_attempts WHERE key = ? OR key LIKE 'ip:%'").run(`u:${username}`).changes;
console.log(`✅ ${username} 비밀번호 재설정 완료 (DB: ${dbPath})`);
console.log(`   로그인 잠금 ${unlocked}건 해제 · 기존 세션 전부 무효화(token_version+1)`);

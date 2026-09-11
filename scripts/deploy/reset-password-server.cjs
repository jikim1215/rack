// 운영 서버용 비밀번호 재설정 (CommonJS — standalone 번들의 better-sqlite3 를 절대경로로 로드).
// 로컬 개발용은 scripts/reset-password.mjs. 정책·저장 규약은 동일: scrypt(sha512(평문), salt).
// 사용: sudo -u asset /opt/asset-inventory/node/bin/node reset-password-server.cjs <APP_DIR> <이메일> <새비밀번호>
const { createHash, randomBytes, scryptSync } = require("crypto");
const [APP, username, plain] = process.argv.slice(2);
if (!APP || !username || !plain) {
  console.error("사용법: node reset-password-server.cjs <APP_DIR> <이메일> <새비밀번호>");
  process.exit(1);
}
const classes = [/[a-zA-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(plain)).length;
if (plain.length < 8 || plain.length > 256 || classes < 2) {
  console.error("비밀번호 정책 위반: 8~256자, 영문/숫자/특수문자 중 2종 이상");
  process.exit(1);
}
const Database = require(`${APP}/.next/standalone/node_modules/better-sqlite3`);
const db = new Database(`${APP}/data.db`);
const pre = createHash("sha512").update(plain).digest("hex");
const salt = randomBytes(32).toString("hex");
const hash = scryptSync(pre, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
const res = db
  .prepare("UPDATE users SET password_hash = ?, is_active = 1, must_change_password = 0, token_version = token_version + 1 WHERE username = ?")
  .run(`${salt}:${hash}`, username);
if (res.changes === 0) {
  console.error(`'${username}' 없음. 계정 목록:`);
  for (const u of db.prepare("SELECT username, role, is_active FROM users ORDER BY id").all()) {
    console.error(`  - ${u.username} (${u.role}${u.is_active ? "" : ", 비활성"})`);
  }
  process.exit(1);
}
const unlocked = db.prepare("DELETE FROM login_attempts WHERE key = ? OR key LIKE 'ip:%'").run(`u:${username}`).changes;
console.log(`✅ ${username} 재설정 완료 · 잠금 ${unlocked}건 해제 · 기존 세션 무효화`);

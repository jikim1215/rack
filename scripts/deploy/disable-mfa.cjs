// ── 2단계 인증 강제 해제 (서버 CLI, 최후 수단) ──
// 총괄 본인이 인증 기기를 잃고 백업 코드도 없어 UI 로 들어갈 수 없을 때만 사용한다.
// (타인 계정 해제는 UI: 설정 → 사용자 관리. db-seed.mjs 는 절대 쓰지 말 것 — 전체 테이블 삭제)
//
// 사용: sudo -u asset /opt/asset-inventory/node/bin/node disable-mfa.cjs /opt/asset-inventory <이메일>
const [APP, username] = process.argv.slice(2);
if (!APP || !username) {
  console.error("사용법: node disable-mfa.cjs <APP_DIR> <이메일>");
  process.exit(1);
}
const Database = require(`${APP}/.next/standalone/node_modules/better-sqlite3`);
const db = new Database(`${APP}/data.db`);

const user = db.prepare("SELECT id, username, totp_enabled FROM users WHERE username = ?").get(username);
if (!user) {
  console.error(`'${username}' 없음. 계정 목록:`);
  for (const u of db.prepare("SELECT username, role, totp_enabled FROM users ORDER BY id").all()) {
    console.error(`  - ${u.username} (${u.role}${u.totp_enabled ? ", 2단계 인증 켜짐" : ""})`);
  }
  process.exit(1);
}
if (!user.totp_enabled) {
  console.log(`ℹ ${username} 은(는) 2단계 인증이 꺼져 있습니다. 변경 없음.`);
  process.exit(0);
}

db.prepare("UPDATE users SET totp_secret = '', totp_enabled = 0, totp_last_counter = 0, backup_codes = '[]', token_version = token_version + 1 WHERE id = ?").run(user.id);
const unlocked = db.prepare("DELETE FROM login_attempts WHERE key = ? OR key = ?").run(`m:${username}`, `u:${username}`).changes;
// 감사로그 — 서버에서 직접 끈 사실을 남긴다(트리거가 append-only 를 보장).
db.prepare(
  `INSERT INTO audit_logs (entity_type, entity_id, entity_name, action, changed_by, changed_fields, old_values, new_values)
   VALUES ('user', ?, ?, 'update', 'server-cli', '["totp_enabled"]', '{"totp_enabled":1}', '{"totp_enabled":0,"mfa_reset_by_cli":1}')`,
).run(user.id, username);

console.log(`✅ ${username} 2단계 인증 해제 · 잠금 ${unlocked}건 해제 · 기존 세션 무효화`);
console.log("   로그인 후 설정 → 2단계 인증에서 반드시 재등록하세요.");

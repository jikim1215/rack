// 업그레이드 전 점검: 지금 운영 DB 의 menu_permissions 가 "실제로 막게 될" 범위를 미리 보여준다.
// P1 이전에는 이 표가 사이드바 숨김에만 쓰였으므로, 반영 즉시 팀/열람 계정의 화면이 닫힐 수 있다.
// 사용: node preflight-perms.mjs <APP_DIR>
const APP = process.argv[2] || "/opt/asset-inventory";
const Database = require(`${APP}/.next/standalone/node_modules/better-sqlite3`);
const db = new Database(`${APP}/data.db`, { readonly: true });

const LABELS = {
  dashboard: "대시보드", assets: "자산관리", subassets: "부속자산", racks: "랙 실장도", ipam: "IP관리",
  distribution: "배선관리", movements: "반입/반출", maintenance: "유지보수", inspection: "자산실사",
  contracts: "계약관리", reports: "통계 리포트", locations: "위치관리", feedback: "개선의견",
  logs: "로그/감사", settings: "설정",
};
// 신규 레지스트리 기본값 (src/lib/menus.ts) — DB 에 행이 없는 키만 이 값으로 시드된다.
const NEW_DEFAULTS = { feedback: { team: [1, 1, 0], viewer: [1, 1, 0] } };

const rows = db.prepare("SELECT role, menu_key, can_access, can_write, can_approve FROM menu_permissions ORDER BY role, menu_key").all();
const byRole = {};
for (const r of rows) (byRole[r.role] ??= {})[r.menu_key] = r;
console.log(`현재 menu_permissions: ${rows.length}행 (역할: ${Object.keys(byRole).join(", ")})\n`);

for (const role of ["team", "viewer"]) {
  const m = byRole[role] || {};
  const denied = Object.entries(m).filter(([, v]) => !v.can_access).map(([k]) => LABELS[k] || k);
  const readOnly = Object.entries(m).filter(([, v]) => v.can_access && !v.can_write).map(([k]) => LABELS[k] || k);
  const writable = Object.entries(m).filter(([, v]) => v.can_access && v.can_write).map(([k]) => LABELS[k] || k);
  const adminOnlyRows = Object.keys(m).filter((k) => k === "logs");
  const missing = Object.keys(LABELS).filter((k) => k !== "logs" && !(k in m));
  console.log(`[${role}]`);
  console.log(`  ⛔ 접근 차단됨 : ${denied.length ? denied.join(", ") : "(없음)"}`);
  console.log(`  👁 읽기만      : ${readOnly.length ? readOnly.join(", ") : "(없음)"}`);
  console.log(`  ✍ 쓰기 가능    : ${writable.length ? writable.join(", ") : "(없음)"}`);
  if (adminOnlyRows.length) console.log(`  🧹 삭제 예정(총괄 전용 메뉴 행): ${adminOnlyRows.join(", ")}`);
  if (missing.length) {
    const added = missing.map((k) => {
      const d = NEW_DEFAULTS[k]?.[role];
      return `${LABELS[k] || k}${d ? `(접근${d[0]}/쓰기${d[1]})` : "(기본값 시드)"}`;
    });
    console.log(`  ➕ 신규 시드 예정: ${added.join(", ")}`);
  }
  console.log("");
}

const ghosts = Object.values(byRole).flatMap((m) => Object.keys(m)).filter((k) => !(k in LABELS));
console.log(ghosts.length ? `🧹 레지스트리 밖(유령) 키 정리 예정: ${[...new Set(ghosts)].join(", ")}` : "🧹 유령 키 없음");
const users = db.prepare("SELECT role, COUNT(*) c FROM users WHERE is_active = 1 GROUP BY role").all();
console.log(`\n활성 계정: ${users.map((u) => `${u.role} ${u.c}명`).join(" · ")}`);
console.log(`감사로그 ${db.prepare("SELECT COUNT(*) c FROM audit_logs").get().c}행 / 자산 ${db.prepare("SELECT COUNT(*) c FROM assets").get().c}대 / user_version ${db.pragma("user_version", { simple: true })}`);

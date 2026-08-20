import Database from "better-sqlite3";
const db = new Database("data.db", { readonly: true });
const q = (s, ...p) => db.prepare(s).all(...p);
const one = (s, ...p) => db.prepare(s).get(...p);

console.log("자산 총수:", one("SELECT COUNT(*) c FROM assets").c);

console.log("\n관리부서(team) 분포:");
for (const r of q("SELECT COALESCE(t.team_name,'(미배정)') tn, COUNT(*) c FROM assets a LEFT JOIN teams t ON a.team_id=t.id GROUP BY a.team_id"))
  console.log("  ", r.tn, r.c);

console.log("\n망구분 분포:", JSON.stringify(q("SELECT COALESCE(NULLIF(network_zone,''),'(빈)') z, COUNT(*) c FROM assets GROUP BY z")));
console.log("상태 분포:", JSON.stringify(q("SELECT status, COUNT(*) c FROM assets GROUP BY status")));
console.log("추가IP(custom field 7) 보유 자산:", one("SELECT COUNT(*) c FROM custom_values WHERE field_id=7").c);

const a = one("SELECT a.id,a.asset_name,a.manufacturer,a.model,a.ip_address,a.network_zone,a.status,a.cia_c,a.cia_i,a.cia_a,t.team_name FROM assets a LEFT JOIN teams t ON a.team_id=t.id WHERE a.asset_name=?", "KISA_ASR1K_KT#");
console.log("\n[KISA_ASR1K_KT#]:", JSON.stringify(a));
console.log("  추가IP cv:", one("SELECT value FROM custom_values WHERE asset_id=? AND field_id=7", a.id).value);

console.log("\nimport_issue:");
for (const r of q("SELECT issue_type, COUNT(*) c FROM import_issue GROUP BY issue_type")) console.log("  ", r.issue_type, r.c);

console.log("\n동명(이름중복) 그룹:");
for (const r of q("SELECT asset_name, COUNT(*) c FROM assets GROUP BY asset_name HAVING c>1")) console.log("  ", JSON.stringify(r.asset_name), r.c);

console.log("\nIP주소 비어있는 자산:", one("SELECT COUNT(*) c FROM assets WHERE ip_address=''").c);
console.log("감사로그(create) 건수:", one("SELECT COUNT(*) c FROM audit_logs WHERE action='create'").c ?? "n/a");

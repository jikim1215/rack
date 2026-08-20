// G011 (P11) verification: synthesize a 587-row asset-final-like xlsx (malformed rows 299/300/302/566,
// department->team mapping, duplicate names, additional IPs), then run the REAL import-asset-final.ts
// (dry-run + actual + idempotent re-run) and assert against a real DB. AC-12/13/14/24.
//
// Run: node --experimental-strip-types scripts/verify-import-final.ts
import Database from "better-sqlite3";
import * as XLSX from "xlsx";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const results: { name: string; pass: boolean }[] = [];
const ck = (n: string, p: boolean) => results.push({ name: n, pass: p });

const dir = mkdtempSync(join(tmpdir(), "importfinal-"));
const xlsxPath = join(dir, "asset-final.xlsx");
const scriptPath = fileURLToPath(new URL("./import-asset-final.ts", import.meta.url));

// ── synthesize 587-row xlsx ──
const header = ["유형", "이름", "제조사", "모델", "시리얼", "IP", "상태", "OS", "사용자", "관리자", "부서", "망구분", "기밀성", "무결성", "가용성", "구매일", "보증만료", "EoS", "랙", "시작U", "크기U", "설명", "접근IP", "추가IP"];
const depts = ["인프라부", "보안부", "전산운영부", ""]; // '' -> 미배정
const MALFORMED = new Set([299, 300, 302, 566]); // 1-indexed data rows with bad IP
const data: any[][] = [];
for (let i = 1; i <= 587; i++) {
  const dept = depts[i % depts.length];
  const badIp = MALFORMED.has(i);
  // a couple of duplicate names for dup_suspect
  const name = i === 10 || i === 11 ? "dup-srv" : `asset-${i}`;
  const ip = badIp ? "10.0.0.999" : `10.${Math.floor(i / 254)}.${i % 254}.1`;
  const addl = i % 50 === 0 ? "172.16.0.1|172.16.0.2" : "";
  data.push(["server", name, "ACME", "M1", `SN-${i}`, ip, "active", "RHEL8", "user", "admin", dept, "업무망", "", "", "", "2020-01-15", "2025-12-31", "2027-06-30", "", "", "", "이관", "", addl]);
}
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...data]), "assets");
writeFileSync(xlsxPath, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

function runImport(extraArgs: string[]) {
  return spawnSync(process.execPath, ["--experimental-strip-types", scriptPath, "--file", xlsxPath, ...extraArgs],
    { encoding: "utf8", env: { ...process.env, ASSET_DB_CWD: dir } });
}

// ── dry-run with --expect 587 ──
const dry = runImport(["--dry-run", "--expect", "587"]);
ck("dry-run exit 0 (587 asserted)", dry.status === 0);
ck("dry-run reports ip_format >= 4 (malformed 299/300/302/566)", /"ip_format":\s*([4-9]|\d\d)/.test(dry.stdout));
const wrongExpect = runImport(["--dry-run", "--expect", "999"]);
ck("dry-run wrong --expect fails (row-count assert)", wrongExpect.status !== 0);

// ── actual import ──
const imp = runImport([]);
ck("import exit 0", imp.status === 0);
ck("import reconcileOk true", /"reconcileOk":\s*true/.test(imp.stdout));

const db = new Database(join(dir, "data.db"));
const assetCount = (db.prepare("SELECT COUNT(*) c FROM assets").get() as any).c;
ck("587 assets imported", assetCount === 587);
const ipFormat = (db.prepare("SELECT COUNT(*) c FROM import_issue WHERE issue_type='ip_format'").get() as any).c;
ck("import_issue ip_format >= 4 (malformed preserved)", ipFormat >= 4);
// malformed assets have operational ip nulled but raw preserved in import_issue
const malformedRaw = db.prepare("SELECT raw_value FROM import_issue WHERE issue_type='ip_format' LIMIT 1").get() as any;
ck("malformed raw IP preserved in import_issue", malformedRaw && malformedRaw.raw_value === "10.0.0.999");
const teams = (db.prepare("SELECT COUNT(*) c FROM teams").get() as any).c;
ck("teams created from departments (>=3)", teams >= 3);
const unassigned = (db.prepare("SELECT COUNT(*) c FROM assets WHERE team_id IS NULL").get() as any).c;
ck("empty-department assets unassigned (team_id NULL)", unassigned > 0);
const deptShadow = db.prepare("SELECT COUNT(*) c FROM assets WHERE department != ''").get() as any;
ck("department preserved as legacy shadow", deptShadow.c > 0);
const dates = db.prepare("SELECT purchase_date, warranty_date, eos_date FROM assets WHERE asset_name='asset-1'").get() as any;
ck("lifecycle dates persisted (purchase/warranty/eos round-trip, no silent drop)", !!dates && dates.purchase_date === "2020-01-15" && dates.warranty_date === "2025-12-31" && dates.eos_date === "2027-06-30");
const dup = (db.prepare("SELECT COUNT(*) c FROM import_issue WHERE issue_type='dup_suspect'").get() as any).c;
ck("dup_suspect recorded (dup-srv pair)", dup >= 2);
const extraIps = (db.prepare("SELECT COUNT(*) c FROM asset_ips WHERE ip_type='extra'").get() as any).c;
ck("additional IPs -> asset_ips(extra)", extraIps > 0);
const audit = (db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE changed_by='import:asset-final'").get() as any).c;
ck("import audit-logged", audit >= 1);
db.close();

// ── idempotent re-run (same batch) ──
const imp2 = runImport([]);
ck("re-import exit 0", imp2.status === 0);
const db2 = new Database(join(dir, "data.db"));
const assetCount2 = (db2.prepare("SELECT COUNT(*) c FROM assets").get() as any).c;
ck("idempotent: still 587 assets after re-run (no duplication)", assetCount2 === 587);
const issue2 = (db2.prepare("SELECT COUNT(*) c FROM import_issue WHERE issue_type='ip_format'").get() as any).c;
ck("idempotent: ip_format issues unchanged after re-run", issue2 === ipFormat);
db2.close();

rmSync(dir, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}: ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.error(`${failed.length} FAILED`); process.exit(1); }
console.log("ALL IMPORT-ASSET-FINAL CHECKS PASSED (real script, synthetic 587-row)");

// G008 real-handler import integration: builds an xlsx (template form) with valid + malformed rows,
// uploads to /api/assets/import as admin, asserts magic-byte rejection + malformed->import_issue +
// operational nulls. Run against a running standalone server: node scripts/test-import-upload.mjs <port>
import * as XLSX from "xlsx";
import crypto from "crypto";

const PORT = process.argv[2] || "4000";
const BASE = `http://localhost:${PORT}`;

async function login() {
  const sha = crypto.createHash("sha512").update("admin123").digest("hex");
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: sha }),
  });
  return (r.headers.get("set-cookie") || "").split(";")[0];
}

function buildXlsx() {
  // template form: row1 header (labels), row2 keys, row3+ data
  const header = ["유형", "이름", "IP주소", "OS", "시리얼번호"];
  const keys = ["asset_type", "asset_name", "ip_address", "os", "serial_number"];
  const rows = [
    ["server", "imp-web-01", "10.50.0.1", "RHEL9", "SN-1"], // valid
    ["server", "imp-badip", "10.50.0.999", "RHEL9", "SN-2"], // ip_format
    ["server", "imp-noos", "10.50.0.2", "", "SN-3"], // missing_os
    ["other", "", "", "", ""], // missing_id
    ["server", "dupe-x", "10.50.0.3", "RHEL9", "SN-4"], // dup pair
    ["server", "dupe-x", "10.50.0.4", "RHEL9", "SN-5"], // dup pair
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, keys, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, "assets");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function upload(cookie, buf, filename) {
  const fd = new FormData();
  fd.append("file", new Blob([buf]), filename);
  const r = await fetch(`${BASE}/api/assets/import`, { method: "POST", headers: { cookie }, body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const out = {};
const cookie = await login();
out.login = cookie ? "ok" : "fail";

// 1. magic-byte: upload a non-xlsx (plain text) -> 400
const bad = await upload(cookie, Buffer.from("this is not an excel file", "utf8"), "fake.xlsx");
out.magicByte = { status: bad.status, error: bad.body.error };

// 2. valid xlsx with malformed rows
const good = await upload(cookie, buildXlsx(), "import.xlsx");
out.import = { status: good.status, imported: good.body.imported, totalRows: good.body.totalRows, issues: good.body.issues };

console.log(JSON.stringify(out, null, 2));

// assertions
const fail = [];
if (out.magicByte.status !== 400) fail.push("magic-byte non-xlsx should be 400");
if (out.import.status !== 200 && out.import.status !== 201) fail.push("valid xlsx import should succeed");
if (!(out.import.imported >= 5)) fail.push("should import >=5 rows (malformed not rejected)");
const iss = out.import.issues || {};
if (!(iss.ip_format >= 1)) fail.push("should record >=1 ip_format issue");
if (!(iss.missing_os >= 1)) fail.push("should record >=1 missing_os issue");
if (!(iss.missing_id >= 1)) fail.push("should record >=1 missing_id issue");
if (!(iss.dup_suspect >= 2)) fail.push("should record dup_suspect for dupe-x pair");
if (fail.length) { console.error("FAILED:\n" + fail.join("\n")); process.exit(1); }
console.log("\nALL IMPORT-UPLOAD CHECKS PASSED");

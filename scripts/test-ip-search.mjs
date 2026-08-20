// G009 (P8/AC-5) real-handler multi-IP search e2e. admin creates assets whose IP lives in each of
// the 3 sources (representative ip_address / asset_ips vip / custom_values additional_ips), then
// GET /api/assets?q=<ip> must find the right asset via UNION matching. Run: node scripts/test-ip-search.mjs <port>
import crypto from "crypto";
const PORT = process.argv[2] || "4200";
const BASE = `http://localhost:${PORT}`;

async function login() {
  const sha = crypto.createHash("sha512").update("admin123").digest("hex");
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: sha }) });
  return (r.headers.get("set-cookie") || "").split(";")[0];
}
async function createAsset(cookie, body) {
  const r = await fetch(`${BASE}/api/assets`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body) });
  return r.json();
}
async function search(cookie, q) {
  const r = await fetch(`${BASE}/api/assets?q=${encodeURIComponent(q)}`, { headers: { cookie } });
  return r.json();
}

// find the additional_ips custom field id
async function additionalIpsFieldId(cookie) {
  const r = await fetch(`${BASE}/api/custom-fields`, { headers: { cookie } });
  const fields = await r.json();
  return (fields.find((f) => f.field_key === "additional_ips") || {}).id;
}

const out = {};
const cookie = await login();
out.login = cookie ? "ok" : "fail";
const addlId = await additionalIpsFieldId(cookie);
out.additionalIpsFieldId = addlId ?? "missing";

// A1: representative ip 10.71.0.1
const a1 = await createAsset(cookie, { asset_type: "server", asset_name: "srch-rep", ip_address: "10.71.0.1", os: "x" });
// A2: multi-IP (asset_ips) vip 10.72.0.2 (representative different)
const a2 = await createAsset(cookie, { asset_type: "network", asset_name: "srch-vip", ip_address: "10.99.9.9", ips: [{ ip_address: "10.72.0.2", ip_type: "vip" }] });
// A3: additional IP via custom_values additional_ips multi-text JSON containing 10.73.0.3
const a3 = await createAsset(cookie, { asset_type: "server", asset_name: "srch-addl", ip_address: "10.88.8.8", os: "x", custom_values: addlId ? { [addlId]: JSON.stringify(["10.73.0.3", "10.73.0.4"]) } : {} });

const repHit = await search(cookie, "10.71.0.1");
const vipHit = await search(cookie, "10.72.0.2");
const addlHit = await search(cookie, "10.73.0.3");
const noHit = await search(cookie, "10.250.250.250");

out.rep = repHit.map((a) => a.asset_name);
out.vip = vipHit.map((a) => a.asset_name);
out.addl = addlHit.map((a) => a.asset_name);
out.noHit = noHit.length;
console.log(JSON.stringify(out, null, 2));

const fail = [];
if (out.login !== "ok") fail.push("login failed");
if (!repHit.some((a) => a.asset_name === "srch-rep")) fail.push("representative ip search miss");
if (!vipHit.some((a) => a.asset_name === "srch-vip")) fail.push("asset_ips(vip) search miss");
if (addlId && !addlHit.some((a) => a.asset_name === "srch-addl")) fail.push("custom_values(additional_ips) search miss");
if (noHit.length !== 0) fail.push("non-existent IP should return 0");
// representative search must not accidentally return the others
if (repHit.some((a) => a.asset_name === "srch-vip" || a.asset_name === "srch-addl")) fail.push("rep search over-matched");
if (fail.length) { console.error("FAILED:\n" + fail.join("\n")); process.exit(1); }
console.log("\nALL MULTI-IP SEARCH CHECKS PASSED");

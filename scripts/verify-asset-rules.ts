// G008 (P7/AC-4) asset-rules validation module unit test. Pure module (no DB/framework imports),
// loaded directly. Verifies magic-byte detection, per-row validation (malformed -> issue + operational
// null, ADR-009 no department), enum coercion, and duplicate detection.
//
// Run: node --experimental-strip-types scripts/verify-asset-rules.ts
import { pathToFileURL } from "url";
import { join } from "path";

const m = await import(pathToFileURL(join(process.cwd(), "src", "lib", "validation", "asset-rules.ts")).href);
const { isXlsxBuffer, detectSpreadsheetKind, isValidIpv4, validateAssetRow, detectDuplicates } = m;

const results: { name: string; pass: boolean }[] = [];
const ck = (n: string, p: boolean) => results.push({ name: n, pass: p });

// ── magic byte ──
ck("xlsx magic PK\\x03\\x04 -> true", isXlsxBuffer(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14])));
ck("empty-zip magic PK\\x05\\x06 -> true", isXlsxBuffer(new Uint8Array([0x50, 0x4b, 0x05, 0x06])));
ck("legacy xls OLE magic -> not xlsx", !isXlsxBuffer(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])));
ck("detect xls kind", detectSpreadsheetKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])) === "xls");
ck("random bytes -> not xlsx (unknown)", !isXlsxBuffer(new Uint8Array([1, 2, 3, 4])) && detectSpreadsheetKind(new Uint8Array([1, 2, 3, 4])) === "unknown");
ck("short buffer -> false", !isXlsxBuffer(new Uint8Array([0x50, 0x4b])));

// ── ipv4 ──
ck("valid ipv4", isValidIpv4("10.0.0.1") && isValidIpv4("255.255.255.255"));
ck("invalid ipv4 rejected", !isValidIpv4("999.1.1.1") && !isValidIpv4("10.0.0") && !isValidIpv4("abc"));

// ── validateAssetRow ──
const ok = validateAssetRow({ asset_type: "server", asset_name: "web-01", ip_address: "10.0.0.5", os: "RHEL8" });
ck("valid row -> no issues", ok.issues.length === 0);
ck("valid row parsed ip", ok.asset.ip_address === "10.0.0.5");
ck("ParsedAsset has NO department (ADR-009)", !("department" in ok.asset));

const badip = validateAssetRow({ asset_type: "network", asset_name: "sw-1", ip_address: "10.0.0.999" });
ck("bad ip -> ip_format issue", badip.issues.some((i: any) => i.issue_type === "ip_format"));
ck("bad ip -> operational ip nulled ('')", badip.asset.ip_address === "");
ck("bad ip -> raw preserved in issue", badip.issues.find((i: any) => i.issue_type === "ip_format")?.raw_value === "10.0.0.999");

const noid = validateAssetRow({ asset_type: "other", asset_name: "", serial_number: "", asset_tag: "" });
ck("no identifier -> missing_id issue", noid.issues.some((i: any) => i.issue_type === "missing_id"));
const hasid = validateAssetRow({ asset_type: "other", asset_name: "", serial_number: "SN-1", asset_tag: "" });
ck("serial present -> no missing_id", !hasid.issues.some((i: any) => i.issue_type === "missing_id"));

const noos = validateAssetRow({ asset_type: "server", asset_name: "db-1", os: "" });
ck("server no os -> missing_os issue", noos.issues.some((i: any) => i.issue_type === "missing_os"));
const netNoOs = validateAssetRow({ asset_type: "network", asset_name: "sw-2", os: "" });
ck("network no os -> NO missing_os (only server/vm)", !netNoOs.issues.some((i: any) => i.issue_type === "missing_os"));

const coerce = validateAssetRow({ asset_type: "BOGUS", asset_name: "x", status: "weird", cia_c: "9", cia_i: "2" });
ck("invalid type coerced to 'other'", coerce.asset.asset_type === "other");
ck("invalid status coerced to 'active'", coerce.asset.status === "active");
ck("cia out-of-range -> null", coerce.asset.cia_c === null);
ck("cia valid -> kept", coerce.asset.cia_i === 2);

// ── detectDuplicates ──
const dup = detectDuplicates([
  { id: 1, asset_name: "host" }, { id: 2, asset_name: "host" }, { id: 3, asset_name: "uniq" }, { id: 4, asset_name: "host" },
]);
ck("dup: groupCount=1", dup.groupCount === 1);
ck("dup: suspectIds = [1,2,4]", dup.suspectIds.sort((a: number, b: number) => a - b).join(",") === "1,2,4");
ck("dup: unique name not suspect", !dup.suspectIds.includes(3));

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}: ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.error(`${failed.length} FAILED`); process.exit(1); }
console.log("ALL ASSET-RULES CHECKS PASSED");

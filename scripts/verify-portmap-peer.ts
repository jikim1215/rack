// G003 residual-leak regression test (architect re-review P1): the portmap ports query must
// hide the CONNECTED PEER asset identity when the peer belongs to another team, while keeping
// the owner's own port row visible. Replicates the exact query shape from src/app/portmap/page.tsx
// against a real sqlite DB with a cross-team port connection.
//
// Run: node --experimental-strip-types scripts/verify-portmap-peer.ts
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

const a = await import(pathToFileURL(join(process.cwd(), "src", "lib", "authz.ts")).href);
const { actorFromSession, scopeWhere } = a;
const ses = (role: string, teamId: number | null) => ({ userId: 1, username: "u", displayName: "", role, teamId, exp: Date.now() + 1e6 });

const dir = mkdtempSync(join(tmpdir(), "portmap-"));
const db = new Database(join(dir, "t.db"));
db.exec(`
  CREATE TABLE assets (id INTEGER PRIMARY KEY, asset_name TEXT, team_id INTEGER);
  CREATE TABLE ports (id INTEGER PRIMARY KEY, asset_id INTEGER, port_number INTEGER, port_name TEXT, connected_to_port_id INTEGER);
  INSERT INTO assets (id,asset_name,team_id) VALUES (1,'t1-sw',1),(2,'t2-core',2),(3,'t1-srv',1);
  -- t1-sw port1 (id 10) <-> t2-core port1 (id 20): CROSS-TEAM connection
  -- t1-sw port2 (id 11) <-> t1-srv port1 (id 30): SAME-TEAM connection
  INSERT INTO ports (id,asset_id,port_number,port_name,connected_to_port_id) VALUES
    (10,1,1,'Gi0/1',20),(20,2,1,'Te1/1',10),
    (11,1,2,'Gi0/2',30),(30,3,1,'eth0',11);
`);

function portsFor(actor: any) {
  const assetScope = scopeWhere(actor, "a.team_id");
  const peerScope = scopeWhere(actor, "ca.team_id");
  return db.prepare(`
    SELECT p.id, p.asset_id, a.asset_name as asset_name,
      CASE WHEN ${peerScope.sql} THEN cp.port_name ELSE NULL END as connected_port_name,
      CASE WHEN ${peerScope.sql} THEN ca.asset_name ELSE NULL END as connected_asset_name
    FROM ports p
    JOIN assets a ON p.asset_id = a.id
    LEFT JOIN ports cp ON p.connected_to_port_id = cp.id
    LEFT JOIN assets ca ON cp.asset_id = ca.id
    WHERE ${assetScope.sql}
    ORDER BY p.id
  `).all(...peerScope.params, ...peerScope.params, ...assetScope.params) as any[];
}

const results: { name: string; pass: boolean }[] = [];
const ck = (name: string, pass: boolean) => results.push({ name, pass });

const team1 = actorFromSession(ses("team", 1));
const admin = actorFromSession(ses("admin", null));

const t1 = portsFor(team1);
const t1ById = Object.fromEntries(t1.map((r) => [r.id, r]));
// team1 sees only its own ports (10,11) — not t2-core(20) or t1-srv... t1-srv(30) is team1 so visible too
ck("team1 sees own ports only (10,11,30)", t1.map((r) => r.id).sort((x, y) => x - y).join(",") === "10,11,30");
ck("team1 does NOT see t2-core port 20", !t1ById[20]);
// CROSS-TEAM peer hidden: port 10 connected to t2-core -> connected_asset_name NULL
ck("LEAK-CHECK: port10 cross-team peer name hidden (NULL)", t1ById[10] && t1ById[10].connected_asset_name === null);
ck("LEAK-CHECK: port10 cross-team peer port hidden (NULL)", t1ById[10] && t1ById[10].connected_port_name === null);
ck("port10 owner row still visible (UX preserved)", t1ById[10] && t1ById[10].asset_name === "t1-sw");
// SAME-TEAM peer visible: port 11 connected to t1-srv -> name visible
ck("same-team peer name visible (port11 -> t1-srv)", t1ById[11] && t1ById[11].connected_asset_name === "t1-srv");

// admin sees everything incl peer names
const adm = portsFor(admin);
const admById = Object.fromEntries(adm.map((r) => [r.id, r]));
ck("admin sees all 4 ports", adm.length === 4);
ck("admin sees cross-team peer name (port10 -> t2-core)", admById[10] && admById[10].connected_asset_name === "t2-core");

db.close();
rmSync(dir, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}: ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.error(`${failed.length} FAILED`); process.exit(1); }
console.log("PORTMAP PEER-SCOPE OK: no cross-team peer identity leak");

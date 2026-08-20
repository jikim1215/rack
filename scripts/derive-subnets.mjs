#!/usr/bin/env node
// 실제 정보자산 IP 분포에서 /24 대역을 추출해 ip_subnets에 등록/갱신한다(멱등 upsert).
// 연계 IP = asset_ips.ip_address + assets.ip_address(대표) + assets.access_ip(접근).
// 대역명/설명은 멤버 자산의 description("위치 / 망구분 / 도입") 다수결로 추론한다.
// 게이트웨이는 asset_ips.gateway 다수결. 실데이터에 호스트가 없는 데모 서브넷은 제거.
//
// 실행: node scripts/derive-subnets.mjs [--dry-run]
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.ASSET_DB_PATH ? path.resolve(process.env.ASSET_DB_PATH) : path.join(__dirname, "..", "data.db");
const DRY = process.argv.includes("--dry-run");

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const net24 = (ip) => ip.split(".").slice(0, 3).join(".") + ".0";
const valid = (ip) => IPV4.test(String(ip ?? "").trim());
const top = (m) => (m.size ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : "");
const bump = (m, k) => { if (k) m.set(k, (m.get(k) ?? 0) + 1); };

const db = new Database(DB);

// 자산별: 보유 IP 전량(대표/접근/다중) + description
const assets = db.prepare("SELECT id, ip_address, access_ip, description FROM assets").all();
const multi = db.prepare("SELECT asset_id, ip_address, gateway FROM asset_ips").all();
const ipsByAsset = new Map(); // asset_id -> Set(ip)
for (const a of assets) {
  const set = new Set();
  if (valid(a.ip_address)) set.add(a.ip_address.trim());
  // 접근 IP는 다중값(| , 줄바꿈/", " 조인)일 수 있어 분리 후 유효 IPv4만 수집
  for (const tok of String(a.access_ip ?? "").split(/[|,\r\n]+/)) { const t = tok.trim(); if (valid(t)) set.add(t); }
  ipsByAsset.set(a.id, set);
}
for (const m of multi) if (valid(m.ip_address)) (ipsByAsset.get(m.asset_id) ?? new Set()).add(m.ip_address.trim());

// /24별 집계: 호스트 / 위치 / 망구분 / 게이트웨이
const nets = new Map(); // net -> {hosts:Set, loc:Map, zone:Map, gw:Map, seen:Set(asset_id)}
const ensure = (net) => {
  let o = nets.get(net);
  if (!o) { o = { hosts: new Set(), loc: new Map(), zone: new Map(), gw: new Map(), seen: new Set() }; nets.set(net, o); }
  return o;
};
for (const a of assets) {
  const ips = ipsByAsset.get(a.id) ?? new Set();
  const desc = String(a.description ?? "").trim();
  let loc = "", zone = "";
  if (desc.includes("/")) {
    const p = desc.split("/").map((s) => s.trim());
    if (p[0] && p[0] !== "-") loc = p[0];
    if (p[1] && p[1] !== "-" && !/^도입/.test(p[1])) zone = p[1];
  }
  const byNet = new Set([...ips].map(net24));
  for (const net of byNet) {
    const o = ensure(net);
    if (!o.seen.has(a.id)) { o.seen.add(a.id); bump(o.loc, loc); bump(o.zone, zone); }
  }
  for (const ip of ips) ensure(net24(ip)).hosts.add(ip);
}
for (const m of multi) {
  if (!valid(m.ip_address) || !valid(m.gateway)) continue;
  bump(ensure(net24(m.ip_address)).gw, m.gateway.trim());
}

const derived = [...nets.entries()].map(([net, o]) => {
  const loc = top(o.loc), zone = top(o.zone);
  const name = (loc || zone) ? [loc, zone].filter(Boolean).join(" ") : `${net}/24`;
  const desc = `${net}/24 · 호스트 ${o.hosts.size}개` + (loc ? ` · ${loc}` : "") + (zone ? ` · ${zone}` : "");
  return { net, hosts: o.hosts.size, gateway: top(o.gw), name, desc };
}).sort((a, b) => {
  const x = a.net.split(".").map(Number), y = b.net.split(".").map(Number);
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
});

const derivedNets = new Set(derived.map((d) => d.net));
const current = db.prepare("SELECT id, subnet_name, network_address FROM ip_subnets").all();
const byNetExisting = new Map(current.map((s) => [s.network_address, s]));
const toDelete = current.filter((s) => !derivedNets.has(s.network_address));

console.log(`[DERIVE] DB=${DB}`);
console.log(`  추출 /24=${derived.length}, 삭제(데모/미사용)=${toDelete.length}: ${toDelete.map((s) => `${s.network_address}(${s.subnet_name})`).join(", ") || "없음"}`);
for (const d of derived) console.log(`    ${d.net}/24  hosts=${String(d.hosts).padStart(3)}  gw=${d.gateway || "-"}  name="${d.name}"`);

if (DRY) { console.log("[DRY-RUN] 변경 없음"); db.close(); process.exit(0); }

const tx = db.transaction(() => {
  const del = db.prepare("DELETE FROM ip_subnets WHERE id = ?");
  for (const s of toDelete) del.run(s.id);
  const ins = db.prepare(`INSERT INTO ip_subnets (subnet_name, network_address, subnet_mask, gateway, vlan_id, location_id, description)
    VALUES (?, ?, '255.255.255.0', ?, '', NULL, ?)`);
  const upd = db.prepare("UPDATE ip_subnets SET subnet_name = ?, gateway = ?, description = ? WHERE id = ?");
  let ins_n = 0, upd_n = 0;
  for (const d of derived) {
    const ex = byNetExisting.get(d.net);
    if (ex) { upd.run(d.name, d.gateway, d.desc, ex.id); upd_n++; }
    else { ins.run(d.name, d.net, d.gateway, d.desc); ins_n++; }
  }
  return { ins_n, upd_n };
});
const { ins_n, upd_n } = tx();
db.pragma("wal_checkpoint(TRUNCATE)");
console.log(`[OK] 삭제 ${toDelete.length}, 등록 ${ins_n}, 갱신 ${upd_n}. 현재 서브넷=${db.prepare("SELECT COUNT(*) c FROM ip_subnets").get().c}`);
db.close();

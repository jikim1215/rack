"use client";

import { useState } from "react";
import { Globe, Plus, Trash2 } from "lucide-react";

interface Subnet {
  id: number;
  subnet_name: string;
  network_address: string;
  subnet_mask: string;
  gateway: string;
  vlan_id: string;
  location_id: number | null;
  location_name: string | null;
  description: string;
}

interface AssetIp {
  id: number;
  asset_id: number;
  ip_address: string;
  ip_type: string;
  interface_name: string;
  asset_name: string;
}

interface Location {
  id: number;
  location_name: string;
}

const maskOptions: { label: string; mask: string; count: number }[] = [
  { label: "/24", mask: "255.255.255.0", count: 256 },
  { label: "/25", mask: "255.255.255.128", count: 128 },
  { label: "/26", mask: "255.255.255.192", count: 64 },
  { label: "/27", mask: "255.255.255.224", count: 32 },
  { label: "/28", mask: "255.255.255.240", count: 16 },
];

function ipToNum(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function maskToCidr(mask: string): number {
  const n = ipToNum(mask);
  let bits = 0;
  let v = n;
  while (v & 0x80000000) { bits++; v = (v << 1) >>> 0; }
  return bits;
}

function numToIp(num: number): string {
  return [(num >>> 24) & 0xff, (num >>> 16) & 0xff, (num >>> 8) & 0xff, num & 0xff].join(".");
}

export function IpamView({ subnets: initSubnets, assetIps, locations }: {
  subnets: Subnet[];
  assetIps: AssetIp[];
  locations: Location[];
}) {
  const [subnets, setSubnets] = useState<Subnet[]>(initSubnets);
  const [selected, setSelected] = useState<number | null>(initSubnets[0]?.id ?? null);
  const [hoveredIp, setHoveredIp] = useState<{ ip: string; asset?: string; iface?: string; x: number; y: number } | null>(null);

  // 추가 폼
  const [form, setForm] = useState({
    subnet_name: "", network_address: "", subnet_mask: "255.255.255.0",
    gateway: "", vlan_id: "", location_id: "",
  });
  const [saving, setSaving] = useState(false);

  const selectedSubnet = subnets.find((s) => s.id === selected);

  // 서브넷별 IP 사용 매핑
  function getSubnetIps(subnet: Subnet) {
    const netNum = ipToNum(subnet.network_address);
    const cidr = maskToCidr(subnet.subnet_mask);
    const mask = (0xFFFFFFFF << (32 - cidr)) >>> 0;
    const netStart = netNum & mask;
    const count = ~mask >>> 0;
    const total = count + 1;
    const broadcastNum = netStart + count;

    const ipMap = new Map<number, AssetIp>();
    for (const aip of assetIps) {
      const n = ipToNum(aip.ip_address);
      if (n >= netStart && n <= broadcastNum) {
        ipMap.set(n - netStart, aip);
      }
    }

    const gwNum = subnet.gateway ? ipToNum(subnet.gateway) : -1;
    const gwOffset = gwNum >= netStart && gwNum <= broadcastNum ? gwNum - netStart : -1;

    return { netStart, total, ipMap, gwOffset, broadcastOffset: count };
  }

  function getSubnetUsage(subnet: Subnet) {
    const { total, ipMap } = getSubnetIps(subnet);
    // 네트워크+브로드캐스트 제외한 사용 가능
    const usable = total - 2;
    const used = ipMap.size;
    return { total, usable, used, pct: usable > 0 ? Math.round((used / usable) * 100) : 0 };
  }

  // 전체 통계
  const globalStats = subnets.reduce(
    (acc, s) => {
      const u = getSubnetUsage(s);
      acc.totalSubnets++;
      acc.totalIps += u.total;
      acc.usedIps += u.used;
      acc.unusedIps += u.usable - u.used;
      return acc;
    },
    { totalSubnets: 0, totalIps: 0, usedIps: 0, unusedIps: 0 }
  );
  const globalPct = globalStats.totalIps - globalStats.totalSubnets * 2 > 0
    ? Math.round((globalStats.usedIps / (globalStats.totalIps - globalStats.totalSubnets * 2)) * 100)
    : 0;

  async function addSubnet() {
    if (!form.subnet_name || !form.network_address) return;
    setSaving(true);
    try {
      const res = await fetch("/api/subnets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const created = await res.json();
        const loc = locations.find((l) => l.id === Number(form.location_id));
        setSubnets((prev) => [...prev, { ...created, location_name: loc?.location_name ?? null }]);
        setSelected(created.id);
        setForm({ subnet_name: "", network_address: "", subnet_mask: "255.255.255.0", gateway: "", vlan_id: "", location_id: "" });
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteSubnet(id: number) {
    if (!confirm("이 서브넷을 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/subnets/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSubnets((prev) => prev.filter((s) => s.id !== id));
      if (selected === id) setSelected(subnets.find((s) => s.id !== id)?.id ?? null);
    }
  }

  // IP 격자 렌더
  function renderGrid(subnet: Subnet) {
    const { netStart, total, ipMap, gwOffset, broadcastOffset } = getSubnetIps(subnet);
    const cidr = maskToCidr(subnet.subnet_mask);
    const cols = total <= 32 ? total : 16;
    const rows = Math.ceil(total / cols);

    return (
      <div>
        {/* 범례 */}
        <div className="flex gap-4 mb-4 text-xs text-ink-2">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-signal inline-block" /> 사용중</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-200 inline-block" /> 미사용</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-warn inline-block" /> 게이트웨이</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-400 inline-block" /> 네트워크/브로드캐스트</span>
        </div>

        <div
          className="grid gap-[2px]"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: total }, (_, offset) => {
            const isNetwork = offset === 0;
            const isBroadcast = offset === broadcastOffset;
            const isGw = offset === gwOffset;
            const assigned = ipMap.get(offset);
            const ipAddr = numToIp(netStart + offset);

            let bg = "bg-slate-200";
            if (isNetwork || isBroadcast) bg = "bg-slate-400";
            else if (isGw) bg = "bg-warn";
            else if (assigned) bg = "bg-signal text-white";

            return (
              <div
                key={offset}
                className={`hover-cell ${bg} rounded text-[10px] font-mono flex items-center justify-center cursor-default
                  ${total <= 32 ? "w-10 h-10" : "h-7"}`}
                onMouseEnter={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setHoveredIp({
                    ip: ipAddr,
                    asset: assigned?.asset_name,
                    iface: assigned?.interface_name,
                    x: r.left + r.width / 2,
                    y: r.top,
                  });
                }}
                onMouseLeave={() => setHoveredIp(null)}
              >
                {offset}
              </div>
            );
          })}
        </div>

        {/* 서브넷 정보 */}
        <div className="mt-4 grid grid-cols-4 gap-3 text-sm">
          <div className="panel p-3">
            <div className="text-ink-3 text-xs">네트워크</div>
            <div className="num font-medium">{subnet.network_address}/{cidr}</div>
          </div>
          <div className="panel p-3">
            <div className="text-ink-3 text-xs">게이트웨이</div>
            <div className="num font-medium">{subnet.gateway || "-"}</div>
          </div>
          <div className="panel p-3">
            <div className="text-ink-3 text-xs">VLAN</div>
            <div className="num font-medium">{subnet.vlan_id || "-"}</div>
          </div>
          <div className="panel p-3">
            <div className="text-ink-3 text-xs">위치</div>
            <div className="font-medium">{subnet.location_name || "-"}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 통계 */}
      <div className="grid grid-cols-5 gap-3">
        <div className="panel p-4 text-center">
          <div className="text-2xl font-bold num">{globalStats.totalSubnets}</div>
          <div className="text-xs text-ink-3">전체 서브넷</div>
        </div>
        <div className="panel p-4 text-center">
          <div className="text-2xl font-bold num">{globalStats.totalIps}</div>
          <div className="text-xs text-ink-3">전체 IP</div>
        </div>
        <div className="panel p-4 text-center">
          <div className="text-2xl font-bold num text-signal">{globalStats.usedIps}</div>
          <div className="text-xs text-ink-3">사용중</div>
        </div>
        <div className="panel p-4 text-center">
          <div className="text-2xl font-bold num text-idle">{globalStats.unusedIps}</div>
          <div className="text-xs text-ink-3">미사용</div>
        </div>
        <div className="panel p-4 text-center">
          <div className="text-2xl font-bold num">{globalPct}%</div>
          <div className="text-xs text-ink-3">사용률</div>
        </div>
      </div>

      {/* 메인 레이아웃 */}
      <div className="flex gap-6">
        {/* 좌측: 서브넷 목록 + 추가 폼 */}
        <div className="w-[250px] shrink-0 space-y-3">
          <div className="panel p-3">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-1 text-ink">
              <Globe className="w-4 h-4" /> 서브넷 목록
            </h3>
            <div className="space-y-1">
              {subnets.map((s) => {
                const usage = getSubnetUsage(s);
                const cidr = maskToCidr(s.subnet_mask);
                return (
                  <div
                    key={s.id}
                    onClick={() => setSelected(s.id)}
                    className={`cursor-pointer px-3 py-2 rounded text-sm transition-colors group ${
                      selected === s.id ? "bg-ink text-white font-medium" : "text-ink-2 hover:bg-slate-100"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium truncate">{s.subnet_name}</div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteSubnet(s.id); }}
                        className="opacity-0 group-hover:opacity-100 text-fault hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="text-xs num opacity-70">{s.network_address}/{cidr}</div>
                    {/* 사용률 바 */}
                    <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-signal rounded-full transition-all"
                        style={{ width: `${usage.pct}%` }}
                      />
                    </div>
                    <div className="text-[10px] num opacity-70 mt-0.5">{usage.used}/{usage.usable} ({usage.pct}%)</div>
                  </div>
                );
              })}
              {subnets.length === 0 && (
                <div className="text-xs text-ink-3 text-center py-4">서브넷 없음</div>
              )}
            </div>
          </div>

          {/* 추가 폼 */}
          <div className="panel p-3">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-1 text-ink">
              <Plus className="w-4 h-4" /> 서브넷 추가
            </h3>
            <div className="space-y-2">
              <input
                className="form-input w-full text-sm"
                placeholder="서브넷 이름"
                value={form.subnet_name}
                onChange={(e) => setForm({ ...form, subnet_name: e.target.value })}
              />
              <input
                className="form-input w-full text-sm font-mono"
                placeholder="네트워크 주소 (x.x.x.x)"
                value={form.network_address}
                onChange={(e) => setForm({ ...form, network_address: e.target.value })}
              />
              <select
                className="form-input w-full text-sm"
                value={form.subnet_mask}
                onChange={(e) => setForm({ ...form, subnet_mask: e.target.value })}
              >
                {maskOptions.map((m) => (
                  <option key={m.label} value={m.mask}>{m.label} ({m.mask})</option>
                ))}
              </select>
              <input
                className="form-input w-full text-sm font-mono"
                placeholder="게이트웨이"
                value={form.gateway}
                onChange={(e) => setForm({ ...form, gateway: e.target.value })}
              />
              <input
                className="form-input w-full text-sm"
                placeholder="VLAN ID"
                value={form.vlan_id}
                onChange={(e) => setForm({ ...form, vlan_id: e.target.value })}
              />
              <select
                className="form-input w-full text-sm"
                value={form.location_id}
                onChange={(e) => setForm({ ...form, location_id: e.target.value })}
              >
                <option value="">위치 선택</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.location_name}</option>
                ))}
              </select>
              <button
                className="btn-ink w-full text-sm py-2 disabled:opacity-50"
                disabled={saving || !form.subnet_name || !form.network_address}
                onClick={addSubnet}
              >
                {saving ? "저장중..." : "추가"}
              </button>
            </div>
          </div>
        </div>

        {/* 우측: IP 격자 */}
        <div className="flex-1">
          {selectedSubnet ? (
            <div className="panel p-4">
              <h3 className="font-bold text-lg mb-4 text-ink">
                {selectedSubnet.subnet_name}
                <span className="text-sm text-ink-3 num ml-2">
                  {selectedSubnet.network_address}/{maskToCidr(selectedSubnet.subnet_mask)}
                </span>
              </h3>
              {renderGrid(selectedSubnet)}
            </div>
          ) : (
            <div className="panel p-8 text-center text-ink-3">
              서브넷을 선택하거나 추가하세요
            </div>
          )}
        </div>
      </div>

      {/* 툴팁 */}
      {hoveredIp && (
        <div
          className="fixed z-50 bg-ink text-white text-xs rounded px-3 py-2 pointer-events-none border border-line-strong"
          style={{ left: hoveredIp.x, top: hoveredIp.y - 8, transform: "translate(-50%, -100%)" }}
        >
          <div className="num font-medium">{hoveredIp.ip}</div>
          {hoveredIp.asset && <div>{hoveredIp.asset}</div>}
          {hoveredIp.iface && <div className="text-ink-3">{hoveredIp.iface}</div>}
        </div>
      )}
    </div>
  );
}

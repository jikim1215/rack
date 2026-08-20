"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Plus, Trash2, ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { useToast } from "@/components/Toast";
import { UsageGuide } from "@/components/UsageGuide";

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
  team_id?: number | null;
  owner_team_name?: string | null;
  _detected?: boolean; // 자산 IP에서 자동 감지한 미등록 /24 대역(가상)
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

// 구분자 그룹 키: 위치(location_name) 우선, 없으면 네트워크 /16 대역(예: "10.22.x 대역"). 접이식 그룹용.
function subnetGroupKey(s: { location_name: string | null; network_address: string }): string {
  const loc = (s.location_name || "").trim();
  if (loc) return loc;
  const oc = (s.network_address || "").split(".");
  return oc.length >= 2 && oc[0] ? `${oc[0]}.${oc[1]}.x 대역` : "기타";
}

export function IpamView({ subnets: initSubnets, assetIps, locations, canWrite, teams = [], isAdmin = false }: {
  subnets: Subnet[];
  assetIps: AssetIp[];
  locations: Location[];
  canWrite: boolean;
  teams?: { id: number; team_name: string }[];
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const { addToast } = useToast();
  const [subnets, setSubnets] = useState<Subnet[]>(initSubnets);
  const [ips, setIps] = useState<AssetIp[]>(assetIps);
  const [selected, setSelected] = useState<number | null>(initSubnets[0]?.id ?? null);
  const [hoveredIp, setHoveredIp] = useState<{ ip: string; asset?: string; iface?: string; x: number; y: number } | null>(null);
  // IP 인라인 편집 팝오버 (셀 클릭): 대표 IP만 이 자리에서 수정/해제 — 원천(assets.ip_address)에 쓰므로 자산관리에 즉시 반영
  const [editCell, setEditCell] = useState<{ entry: AssetIp; x: number; y: number } | null>(null);
  const [editIp, setEditIp] = useState("");
  const [ipSaving, setIpSaving] = useState(false);

  async function patchIp(entry: AssetIp, newIp: string, isUndo = false) {
    setIpSaving(true);
    try {
      const res = await fetch(`/api/assets/${entry.asset_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip_address: newIp }),
      });
      const data = await res.json();
      if (!res.ok) {
        addToast(data.error || "IP 수정에 실패했습니다.", "error");
        return;
      }
      // 로컬 상태 갱신: 대표 IP 행(id = -asset_id)만 대상.
      // 해제 취소(undo)처럼 행이 이미 제거된 경우엔 재추가한다.
      setIps((prev) => {
        if (newIp === "") return prev.filter((r) => r.id !== entry.id);
        return prev.some((r) => r.id === entry.id)
          ? prev.map((r) => (r.id === entry.id ? { ...r, ip_address: newIp } : r))
          : [...prev, { ...entry, ip_address: newIp }];
      });
      // 실수 복구: 성공 토스트에 "실행 취소" — 원래 값으로 재PATCH (복구 자체도 변경이력에 남는다).
      // undo의 undo는 제공하지 않는다(토글 무한루프 방지, 랙 배치 undo와 동일 정책).
      const undoAction = isUndo
        ? undefined
        : { label: "실행 취소", onClick: () => patchIp({ ...entry, ip_address: newIp }, entry.ip_address, true) };
      addToast(
        isUndo
          ? `'${entry.asset_name}' 대표 IP가 이전 값(${newIp || "없음"})으로 복구되었습니다.`
          : newIp === ""
            ? `'${entry.asset_name}' 대표 IP 해제됨 (${entry.ip_address})`
            : `'${entry.asset_name}' 대표 IP 변경됨: ${entry.ip_address || "(없음)"} → ${newIp}`,
        "success",
        undoAction
      );
      setEditCell(null);
      router.refresh();
    } finally {
      setIpSaving(false);
    }
  }

  // 추가 폼
  const [form, setForm] = useState<{ subnet_name: string; network_address: string; subnet_mask: string; gateway: string; vlan_id: string; location_id: string; team_id: number | "" }>({
    subnet_name: "", network_address: "", subnet_mask: "255.255.255.0",
    gateway: "", vlan_id: "", location_id: "", team_id: "",
  });
  const [saving, setSaving] = useState(false);

  // ── 미등록 IP 자동 감지 ──
  // 등록된 서브넷에 속하지 않는 자산 IP를 /24 대역으로 묶어 "자동 감지 대역"으로 노출한다.
  // 서브넷을 수기 정의하지 않아도 대역별(.0~.255) IP 할당 현황을 바로 볼 수 있고, '등록'으로 정식 서브넷화한다.
  function isCoveredByRegistered(ipNum: number): boolean {
    for (const s of subnets) {
      const net = ipToNum(s.network_address);
      const cidr = maskToCidr(s.subnet_mask);
      const mask = (0xFFFFFFFF << (32 - cidr)) >>> 0;
      const start = (net & mask) >>> 0;
      const end = start + (~mask >>> 0);
      if (ipNum >= start && ipNum <= end) return true;
    }
    return false;
  }
  const detectedSubnets: Subnet[] = (() => {
    const set = new Set<number>();
    for (const aip of ips) {
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(aip.ip_address || "")) continue;
      const n = ipToNum(aip.ip_address);
      if (isCoveredByRegistered(n)) continue;
      set.add((n & 0xFFFFFF00) >>> 0);
    }
    return [...set].sort((a, b) => a - b).map((net24) => ({
      id: -(net24 + 1),
      subnet_name: `${numToIp(net24)}/24`,
      network_address: numToIp(net24),
      subnet_mask: "255.255.255.0",
      gateway: "", vlan_id: "", location_id: null, location_name: null, description: "",
      team_id: null, owner_team_name: null, _detected: true,
    }));
  })();

  const selectedSubnet = subnets.find((s) => s.id === selected) || detectedSubnets.find((s) => s.id === selected);

  // 구분자 그룹(접이식): 서브넷이 너무 많아 한 번에 다 보여주지 않고 그룹 클릭 시 세부 펼침.
  const subnetGroups = (() => {
    const m = new Map<string, Subnet[]>();
    for (const sn of subnets) {
      const k = subnetGroupKey(sn);
      const arr = m.get(k);
      if (arr) arr.push(sn); else m.set(k, [sn]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"));
  })();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(initSubnets[0] ? [subnetGroupKey(initSubnets[0])] : []),
  );
  const toggleGroup = (k: string) =>
    setExpandedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  // 서브넷별 IP 사용 매핑
  function getSubnetIps(subnet: Subnet) {
    const netNum = ipToNum(subnet.network_address);
    const cidr = maskToCidr(subnet.subnet_mask);
    const mask = (0xFFFFFFFF << (32 - cidr)) >>> 0;
    // & 는 32비트 부호있는 연산이라 첫 옥텟 ≥128(172/192/211.x 등) 대역에서 음수가 된다 → >>>0 로 부호없는 정규화.
    const netStart = (netNum & mask) >>> 0;
    const count = ~mask >>> 0;
    const total = count + 1;
    const broadcastNum = netStart + count;

    const ipMap = new Map<number, AssetIp>();
    for (const aip of ips) {
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

  // editingId가 있으면 좌측 폼이 '수정 모드'로 동작한다 (잘못 등록한 대역은 삭제 대신 수정으로 정정)
  const [editingId, setEditingId] = useState<number | null>(null);

  function startEditSubnet(s: Subnet) {
    setEditingId(s.id);
    setForm({
      team_id: s.team_id ?? "",
      subnet_name: s.subnet_name,
      network_address: s.network_address,
      subnet_mask: s.subnet_mask,
      gateway: s.gateway || "",
      vlan_id: s.vlan_id || "",
      location_id: s.location_id ? String(s.location_id) : "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({ subnet_name: "", network_address: "", subnet_mask: "255.255.255.0", gateway: "", vlan_id: "", location_id: "", team_id: "" });
  }

  // 자동 감지 대역을 추가 폼에 프리필(사용자가 검토 후 '추가'로 등록)
  function prefillRegister(s: Subnet) {
    setEditingId(null);
    setForm({ subnet_name: `${s.network_address}/24`, network_address: s.network_address, subnet_mask: "255.255.255.0", gateway: "", vlan_id: "", location_id: "", team_id: "" });
  }

  async function addSubnet() {
    if (!form.subnet_name || !form.network_address) return;
    setSaving(true);
    try {
      const isEdit = editingId != null;
      const res = await fetch(isEdit ? `/api/subnets/${editingId}` : "/api/subnets", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, location_id: form.location_id || null, team_id: form.team_id === "" ? null : form.team_id }),
      });
      if (res.ok) {
        const saved = await res.json();
        const loc = locations.find((l) => l.id === Number(form.location_id));
        if (isEdit) {
          setSubnets((prev) => prev.map((s) => (s.id === editingId ? { ...s, ...saved, location_name: loc?.location_name ?? null } : s)));
          addToast(`서브넷 '${saved.subnet_name}' 수정됨 — 대역 내 IP 데이터는 그대로 유지됩니다.`, "success");
        } else {
          setSubnets((prev) => [...prev, { ...saved, location_name: loc?.location_name ?? null }]);
          setSelected(saved.id);
        }
        cancelEdit();
      } else {
        const data = await res.json().catch(() => ({}));
        addToast(data.error || "저장에 실패했습니다.", "error");
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteSubnet(id: number) {
    const s = subnets.find((x) => x.id === id);
    // 사용중 IP가 있으면 사전 안내 후 차단 (서버도 409로 이중 방어)
    if (s) {
      const usage = getSubnetUsage(s);
      if (usage.used > 0) {
        addToast(
          `'${s.subnet_name}' 대역에 사용중 IP가 ${usage.used}개 있어 삭제할 수 없습니다. 대역 정보가 잘못됐다면 연필(수정) 버튼으로 고치세요.`,
          "error"
        );
        return;
      }
    }
    if (!confirm("이 서브넷(빈 대역)을 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/subnets/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSubnets((prev) => prev.filter((x) => x.id !== id));
      if (editingId === id) cancelEdit();
      if (selected === id) setSelected(subnets.find((x) => x.id !== id)?.id ?? null);
    } else {
      const data = await res.json().catch(() => ({}));
      addToast(data.error || "삭제에 실패했습니다.", "error");
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
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-warn inline-block" /> 게이트웨이(G)</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-400 inline-block" /> 네트워크(N)/브로드캐스트(B)</span>
          {canWrite && <span className="text-ink-3 flex items-center gap-1"><Pencil className="w-3 h-3" /> 사용중 셀을 클릭하면 IP를 바로 수정/해제할 수 있습니다</span>}
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
                className={`hover-cell ${bg} rounded text-[10px] font-mono flex items-center justify-center
                  ${assigned ? "cursor-pointer" : "cursor-default"}
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
                onClick={(e) => {
                  if (!assigned) {
                    // 무반응 방지 (외부 검토 R2-5 합의): 미사용/GW/네트워크 셀도 클릭 이유를 안내
                    if (!isNetwork && !isBroadcast && !isGw) {
                      addToast(`${ipAddr}은(는) 미사용 IP입니다. 신규 할당·이전은 자산관리의 자산 수정에서 수행합니다.`, "info");
                    }
                    return;
                  }
                  const r = e.currentTarget.getBoundingClientRect();
                  setHoveredIp(null);
                  setEditIp(assigned.ip_address);
                  setEditCell({ entry: assigned, x: r.left + r.width / 2, y: r.bottom });
                }}
              >
                {/* 색 외 보조 단서 (외부 검토 R4-4 합의): 특수 셀은 색 + 문자 병행 — G=게이트웨이, N=네트워크, B=브로드캐스트 */}
                {isGw ? <span className="font-bold">G</span> : isNetwork ? <span className="font-bold text-white">N</span> : isBroadcast ? <span className="font-bold text-white">B</span> : offset}
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
      {/* 사용 가이드 (접기/펼치기) */}
      <UsageGuide
        className="text-right"
        items={[
          <>격자의 <strong className="text-ink-2">초록 셀(사용중)</strong>을 클릭하면 그 자리에서 IP를 <strong className="text-ink-2">수정하거나 해제</strong>할 수 있습니다 (Enter 저장, Esc 취소)</>,
          <>여기서 바꾼 IP는 <strong className="text-ink-2">자산관리에 즉시 반영</strong>됩니다 — IP의 원본이 자산 정보 한 곳뿐이라 화면 간 어긋남이 없습니다</>,
          <>잘못 수정했다면 저장 직후 우하단 알림의 <strong className="text-ink-2">"실행 취소"</strong>를 누르세요 — 이전 값으로 즉시 복구됩니다. 알림이 사라진 뒤에는 변경이력에서 이전 값을 확인해 복구할 수 있습니다</>,
          <>모든 변경은 <strong className="text-ink-2">변경이력에 자동 기록</strong>됩니다 (누가·언제·무엇을 — 자산관리의 이력 버튼에서 확인)</>,
          <><strong className="text-ink-2">공인 IP</strong>는 다른 자산과 중복되면 저장이 차단됩니다. 사설 IP(10.x, 172.16~31.x, 192.168.x)는 망 구간별 재사용이 있어 중복을 허용합니다</>,
          <>이 화면에서 직접 수정되는 건 <strong className="text-ink-2">'대표' IP</strong>입니다 — 추가/접근 IP는 팝오버의 <strong className="text-ink-2">"자산관리에서 열기"</strong>로 이동해 수정합니다</>,
          <>셀에 마우스를 올리면 IP와 사용 중인 자산이 표시됩니다. 회색(네트워크/브로드캐스트)·주황(게이트웨이) 셀은 수정 대상이 아닙니다</>,
          <>서브넷은 <strong className="text-ink-2">조회용 대역 정의</strong>라 삭제해도 자산 IP는 지워지지 않지만, 실수 방지를 위해 <strong className="text-ink-2">사용중 IP가 있는 대역은 삭제가 차단</strong>됩니다 — 대역 정보가 잘못됐다면 목록의 연필(수정) 버튼으로 고치세요</>,
        ]}
      />
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
              {subnetGroups.map(([groupKey, items]) => {
                const open = expandedGroups.has(groupKey);
                const gUsed = items.reduce((a, s) => a + getSubnetUsage(s).used, 0);
                const gUsable = items.reduce((a, s) => a + getSubnetUsage(s).usable, 0);
                const gPct = gUsable > 0 ? Math.round((gUsed / gUsable) * 100) : 0;
                return (
                  <div key={groupKey}>
                    <button
                      onClick={() => toggleGroup(groupKey)}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-sm font-semibold text-ink hover:bg-slate-100"
                    >
                      {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                      <span className="truncate flex-1 text-left">{groupKey}</span>
                      <span className="text-[10px] num text-ink-3 shrink-0">{items.length}개 · {gPct}%</span>
                    </button>
                    {open && (
                      <div className="space-y-1 pl-2 mt-1">
                        {items.map((s) => {
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
                                <span className="flex items-center gap-0.5 shrink-0">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); startEditSubnet(s); }}
                                    className="opacity-0 group-hover:opacity-100 hover:bg-slate-200 rounded p-0.5"
                                    title="서브넷 수정 (대역 내 IP는 유지됨)"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); deleteSubnet(s.id); }}
                                    className="opacity-0 group-hover:opacity-100 text-fault hover:bg-red-50 rounded p-0.5"
                                    title="서브넷 삭제 (빈 대역만 가능)"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </span>
                              </div>
                              <div className="text-xs num opacity-70">{s.network_address}/{cidr}
                                {s.owner_team_name && <span className="ml-1 font-sans not-italic text-[10px] px-1 py-0.5 rounded bg-indigo-100 text-indigo-700">{s.owner_team_name}</span>}
                              </div>
                              <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-signal rounded-full transition-all" style={{ width: `${usage.pct}%` }} />
                              </div>
                              <div className="text-[10px] num opacity-70 mt-0.5">{usage.used}/{usage.usable} ({usage.pct}%)</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {subnets.length === 0 && detectedSubnets.length === 0 && (
                <div className="text-xs text-ink-3 text-center py-4">서브넷 없음</div>
              )}

              {/* 자동 감지 대역 (미등록) — 자산 IP에서 바로 파생 */}
              {detectedSubnets.length > 0 && (
                <div className="mt-2 pt-2 border-t border-line">
                  <div className="text-[11px] font-semibold text-warn px-2 mb-1">자동 감지 대역 (미등록) · {detectedSubnets.length}</div>
                  <div className="space-y-1">
                    {detectedSubnets.map((s) => {
                      const usage = getSubnetUsage(s);
                      return (
                        <div
                          key={s.id}
                          onClick={() => setSelected(s.id)}
                          className={`cursor-pointer px-3 py-2 rounded text-sm transition-colors group ${
                            selected === s.id ? "bg-ink text-white font-medium" : "text-ink-2 hover:bg-slate-100"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-medium truncate num">{s.network_address}/24</div>
                            {canWrite && (
                              <button
                                onClick={(e) => { e.stopPropagation(); prefillRegister(s); }}
                                className="opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 shrink-0"
                                title="이 대역을 정식 서브넷으로 등록(폼 프리필)"
                              >등록</button>
                            )}
                          </div>
                          <div className="text-[10px] num opacity-70 mt-0.5">{usage.used}개 IP 사용중</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 추가/수정 폼 (editingId 있으면 수정 모드) */}
          <div className="panel p-3">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-1 text-ink">
              {editingId != null ? <><Pencil className="w-4 h-4" /> 서브넷 수정</> : <><Plus className="w-4 h-4" /> 서브넷 추가</>}
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
              {isAdmin && (
                <select
                  className="form-input w-full text-sm"
                  value={form.team_id}
                  onChange={(e) => setForm({ ...form, team_id: e.target.value === "" ? "" : Number(e.target.value) })}
                >
                  <option value="">소유 팀 — 미지정(총괄 전용)</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.team_name}</option>
                  ))}
                </select>
              )}
              <div className="flex gap-2">
                <button
                  className="btn-ink flex-1 text-sm py-2 disabled:opacity-50"
                  disabled={saving || !form.subnet_name || !form.network_address}
                  onClick={addSubnet}
                >
                  {saving ? "저장중..." : editingId != null ? "수정 저장" : "추가"}
                </button>
                {editingId != null && (
                  <button className="flex-1 text-sm py-2 rounded border border-line-strong text-ink-2 hover:bg-slate-100" onClick={cancelEdit}>
                    취소
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 우측: IP 격자 */}
        <div className="flex-1">
          {selectedSubnet ? (
            <div className="panel p-4">
              <h3 className="font-bold text-lg mb-2 text-ink flex items-center flex-wrap gap-2">
                <span>{selectedSubnet.subnet_name}</span>
                <span className="text-sm text-ink-3 num">
                  {selectedSubnet.network_address}/{maskToCidr(selectedSubnet.subnet_mask)}
                </span>
                {selectedSubnet._detected && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-warn font-medium">미등록 자동 감지</span>
                )}
                {selectedSubnet._detected && canWrite && (
                  <button onClick={() => prefillRegister(selectedSubnet)} className="ml-auto btn-ink text-xs px-2.5 py-1">이 대역 등록</button>
                )}
              </h3>
              {selectedSubnet._detected && (
                <div className="text-xs text-ink-3 mb-3">자산 IP에서 자동 감지된 /24 대역입니다 — 아래는 실제 IP 할당 현황이며, ‘이 대역 등록’ 또는 왼쪽 폼으로 정식 서브넷으로 저장할 수 있습니다(게이트웨이/VLAN/위치 보강).</div>
              )}
              {renderGrid(selectedSubnet)}
            </div>
          ) : (
            <div className="panel p-8 text-center text-ink-3">
              왼쪽에서 서브넷을 선택하면 해당 대역(.0~.255)의 IP 할당 현황이 표시됩니다.<br />
              등록된 서브넷이 없으면 왼쪽 ‘서브넷 추가’로 대역(예: 10.0.0.0/24)을 정의하세요. 자산에 IP가 있으면 ‘자동 감지 대역’에서 바로 확인할 수 있습니다.
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

      {/* IP 편집 팝오버: 대표 IP는 인라인 수정/해제(원천 = assets.ip_address → 자산관리 즉시 반영),
          추가/다중·접근 IP는 원천이 달라 자산관리 상세로 안내 (연계 데이터 단일 원천 관리) */}
      {editCell && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setEditCell(null)} />
          <div
            className="fixed z-50 panel bg-white shadow-lg rounded px-4 py-3 w-[280px] border border-line-strong"
            style={{ left: Math.min(editCell.x, typeof window !== "undefined" ? window.innerWidth - 150 : editCell.x), top: editCell.y + 6, transform: "translateX(-50%)" }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="num font-semibold text-sm">{editCell.entry.ip_address}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-ink-2">{editCell.entry.ip_type === "대표" ? "대표 IP — 여기서 수정 가능" : editCell.entry.ip_type || "다중"}</span>
            </div>
            <div className="text-xs text-ink-2 mb-2 truncate">{editCell.entry.asset_name}</div>
            {canWrite && editCell.entry.ip_type === "대표" ? (
              <div className="space-y-2">
                <input
                  className="form-input w-full text-sm font-mono"
                  value={editIp}
                  autoFocus
                  onChange={(e) => setEditIp(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && editIp.trim() !== "" && editIp.trim() !== editCell.entry.ip_address) patchIp(editCell.entry, editIp.trim());
                    if (e.key === "Escape") setEditCell(null);
                  }}
                />
                <div className="flex gap-2">
                  <button
                    className="btn-ink flex-1 text-xs py-1.5 disabled:opacity-50"
                    disabled={ipSaving || editIp.trim() === "" || editIp.trim() === editCell.entry.ip_address}
                    onClick={() => patchIp(editCell.entry, editIp.trim())}
                  >
                    <Pencil className="w-3 h-3 inline mr-1" />{ipSaving ? "저장중..." : "IP 변경"}
                  </button>
                  <button
                    className="flex-1 text-xs py-1.5 rounded border border-line-strong text-fault hover:bg-red-50 disabled:opacity-50"
                    disabled={ipSaving}
                    onClick={() => { if (confirm(`'${editCell.entry.asset_name}'의 대표 IP를 해제하시겠습니까?`)) patchIp(editCell.entry, ""); }}
                  >
                    IP 해제
                  </button>
                </div>
                <div className="text-[10px] text-ink-3">수정 즉시 자산관리에 반영되고 변경이력이 남습니다.</div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-[11px] text-ink-3">
                  {canWrite
                    ? `'${editCell.entry.ip_type || "다중"}' IP는 원천 데이터가 달라 자산 상세에서 수정합니다.`
                    : "조회 전용 계정은 IP를 수정할 수 없습니다."}
                </div>
                {canWrite && (
                  <a href={`/assets?q=${encodeURIComponent(editCell.entry.asset_name)}`} className="btn-ink block text-center text-xs py-1.5">
                    자산관리에서 열기
                  </a>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

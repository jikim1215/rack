"use client";

import { useState } from "react";
import { Link2, X } from "lucide-react";

const portStatusColors: Record<string, string> = {
  used: "bg-signal",
  unused: "bg-slate-300",
  reserved: "bg-warn",
  disabled: "bg-fault",
};
const portStatusLabels: Record<string, string> = {
  used: "사용중", unused: "미사용", reserved: "예약", disabled: "비활성",
};
const portTypeLabels: Record<string, string> = {
  ethernet: "Ethernet", fiber: "Fiber", console: "Console",
  management: "Mgmt", sfp: "SFP", sfp_plus: "SFP+", qsfp: "QSFP",
};

interface Port {
  id: number;
  asset_id: number;
  port_number: number;
  port_name: string;
  port_type: string;
  speed: string;
  status: string;
  vlan: string;
  description: string;
  connected_to_port_id: number | null;
  connected_port_name: string | null;
  connected_asset_name: string | null;
  asset_name: string;
}

export function PortMapView({ networkAssets, ports }: { networkAssets: any[]; ports: Port[] }) {
  // 포트가 있는 첫 장비를 기본 선택
  const defaultAsset = networkAssets.find((a: any) => ports.some((p) => p.asset_id === a.id))?.id ?? networkAssets[0]?.id ?? null;
  const [selectedAsset, setSelectedAsset] = useState<number | null>(defaultAsset);
  const [statusFilter, setStatusFilter] = useState("");
  const [hoveredPort, setHoveredPort] = useState<Port | null>(null);
  const [connectingPort, setConnectingPort] = useState<Port | null>(null);
  const [connectSearch, setConnectSearch] = useState("");
  const [allPorts, setAllPorts] = useState(ports);

  const assetPorts = allPorts.filter((p) => p.asset_id === selectedAsset);
  const filtered = statusFilter ? assetPorts.filter((p) => p.status === statusFilter) : assetPorts;
  const selectedDevice = networkAssets.find((a: any) => a.id === selectedAsset);

  // 포트 통계
  const stats = {
    total: assetPorts.length,
    used: assetPorts.filter((p) => p.status === "used").length,
    unused: assetPorts.filter((p) => p.status === "unused").length,
    reserved: assetPorts.filter((p) => p.status === "reserved").length,
  };

  async function connectPort(portId: number, targetPortId: number | null) {
    const res = await fetch(`/api/ports/${portId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connected_to_port_id: targetPortId }),
    });
    if (res.ok) {
      // 로컬 상태 업데이트
      setAllPorts((prev) => {
        const updated = [...prev];
        // 기존 연결 해제
        const srcPort = updated.find((p) => p.id === portId);
        if (srcPort?.connected_to_port_id) {
          const oldTarget = updated.find((p) => p.id === srcPort.connected_to_port_id);
          if (oldTarget) { oldTarget.connected_to_port_id = null; oldTarget.connected_asset_name = null; oldTarget.connected_port_name = null; }
        }
        if (targetPortId) {
          const targetPort = updated.find((p) => p.id === targetPortId);
          const targetAsset = networkAssets.find((a: any) => a.id === targetPort?.asset_id);
          // 대상의 기존 연결 해제
          if (targetPort?.connected_to_port_id) {
            const oldSrc = updated.find((p) => p.id === targetPort.connected_to_port_id);
            if (oldSrc) { oldSrc.connected_to_port_id = null; oldSrc.connected_asset_name = null; oldSrc.connected_port_name = null; }
          }
          // 양방향 연결
          if (srcPort && targetPort) {
            srcPort.connected_to_port_id = targetPortId;
            srcPort.connected_asset_name = targetAsset?.asset_name || null;
            srcPort.connected_port_name = targetPort.port_name;
            targetPort.connected_to_port_id = portId;
            targetPort.connected_asset_name = networkAssets.find((a: any) => a.id === srcPort.asset_id)?.asset_name || null;
            targetPort.connected_port_name = srcPort.port_name;
          }
        } else {
          if (srcPort) { srcPort.connected_to_port_id = null; srcPort.connected_asset_name = null; srcPort.connected_port_name = null; }
        }
        return updated;
      });
      setConnectingPort(null);
      setConnectSearch("");
    }
  }

  return (
    <div className="flex gap-6">
      {/* 장비 목록 */}
      <div className="w-64 shrink-0">
        <div className="panel p-3">
          <h3 className="font-semibold text-sm mb-3">장비 선택</h3>
          <div className="space-y-1">
            {networkAssets.map((a: any) => {
              const aPorts = ports.filter((p) => p.asset_id === a.id);
              const usedCount = aPorts.filter((p) => p.status === "used").length;
              return (
                <button
                  key={a.id}
                  onClick={() => setSelectedAsset(a.id)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    selectedAsset === a.id ? "bg-ink text-white font-medium" : "text-ink-2 hover:text-ink hover:bg-slate-100"
                  }`}
                >
                  <div className="font-medium">{a.asset_name}</div>

                  <div className={`text-xs ${selectedAsset === a.id ? "text-white/70" : "text-ink-3"}`}>
                    <span className="num">{a.ip_address}</span> · <span className="num">{usedCount}/{aPorts.length}</span> 포트
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 포트맵 영역 */}
      <div className="flex-1">
        {selectedDevice && (
          <>
            {/* 장비 정보 */}
            <div className="panel p-4 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-lg">{selectedDevice.asset_name}</h3>
                  <p className="text-sm text-ink-2">
                    {selectedDevice.manufacturer} {selectedDevice.model} · <span className="num">{selectedDevice.ip_address}</span>
                  </p>
                  {selectedDevice.rack_name && (
                    <p className="text-xs text-ink-3 mt-1">
                      {selectedDevice.location_name} / {selectedDevice.rack_name}
                    </p>
                  )}
                </div>
                <div className="flex gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold num">{stats.total}</div>
                    <div className="text-xs text-ink-2">전체</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold num text-signal">{stats.used}</div>
                    <div className="text-xs text-ink-2">사용중</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold num text-idle">{stats.unused}</div>
                    <div className="text-xs text-ink-2">미사용</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold num text-warn">{stats.reserved}</div>
                    <div className="text-xs text-ink-2">예약</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 필터 */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm text-ink-2">상태:</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setStatusFilter("")}
                  className={`px-3 py-1 rounded text-xs ${!statusFilter ? "bg-ink text-white" : "bg-slate-100 text-ink hover:bg-slate-200"}`}
                >
                  전체
                </button>
                {Object.entries(portStatusLabels).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setStatusFilter(k)}
                    className={`px-3 py-1 rounded text-xs ${statusFilter === k ? "bg-ink text-white" : "bg-slate-100 text-ink hover:bg-slate-200"}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* 포트 그리드 시각화 */}
            <div className="panel p-4 mb-4">
              <h4 className="font-semibold text-sm mb-3">포트 배치도</h4>
              <div className="flex flex-wrap gap-1.5">
                {filtered.map((port) => (
                  <div
                    key={port.id}
                    className="relative group"
                    onMouseEnter={() => setHoveredPort(port)}
                    onMouseLeave={() => setHoveredPort(null)}
                  >
                    <div
                      className={`w-10 h-10 rounded flex flex-col items-center justify-center cursor-pointer hover-cell ${portStatusColors[port.status]}`}
                    >
                      <span className="text-[9px] font-bold text-white num">{port.port_number}</span>
                      <span className="text-[7px] text-white/70">{portTypeLabels[port.port_type]?.slice(0, 3) || ""}</span>
                    </div>

                    {/* 포트 툴팁 */}
                    {hoveredPort?.id === port.id && (
                      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 bg-ink text-white p-2.5 rounded-lg shadow-xl text-xs whitespace-nowrap pointer-events-none">
                        <div className="font-bold">{port.port_name || `Port ${port.port_number}`}</div>
                        <div className="text-white/70 mt-1 space-y-0.5">
                          <div>유형: {portTypeLabels[port.port_type] || port.port_type}</div>
                          <div>속도: <span className="num">{port.speed || "-"}</span></div>
                          <div>상태: {portStatusLabels[port.status]}</div>
                          {port.vlan && <div>VLAN: <span className="num">{port.vlan}</span></div>}
                          {port.connected_asset_name && (
                            <div className="text-signal">
                              → {port.connected_asset_name} ({port.connected_port_name})
                            </div>
                          )}
                        </div>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-ink" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 포트 상세 테이블 */}
            <div className="panel overflow-hidden">
              <table className="w-full text-sm" style={{ minWidth: 600 }}>
                <thead>
                  <tr className="panel-head text-left text-ink-2">
                    <th className="p-3 w-16">포트</th>
                    <th className="p-3 w-28">이름</th>
                    <th className="p-3 w-20">유형</th>
                    <th className="p-3 w-20">속도</th>
                    <th className="p-3 w-16">VLAN</th>
                    <th className="p-3 w-20">상태</th>
                    <th className="p-3">연결 대상</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((port) => (
                    <tr key={port.id} className="border-b border-line last:border-0 hover:bg-slate-100">
                      <td className="p-3 num">{port.port_number}</td>
                      <td className="p-3 font-medium">{port.port_name}</td>
                      <td className="p-3 text-ink-2">{portTypeLabels[port.port_type] || port.port_type}</td>
                      <td className="p-3 text-ink-2 num">{port.speed || "-"}</td>
                      <td className="p-3 num text-xs">{port.vlan || "-"}</td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1 text-xs`}>
                          <span className={`led ${port.status === "used" ? "led-up" : port.status === "reserved" ? "led-warn" : port.status === "disabled" ? "led-fault" : "led-idle"}`} />
                          {portStatusLabels[port.status]}
                        </span>
                      </td>
                      <td className="p-3 text-xs">
                        <button
                          onClick={() => { setConnectingPort(port); setConnectSearch(""); }}
                          className="text-left hover:underline"
                        >
                          {port.connected_asset_name ? (
                            <span className="text-signal">{port.connected_asset_name} · {port.connected_port_name}</span>
                          ) : (
                            <span className="text-ink-3 italic flex items-center gap-1"><Link2 size={12} /> 연결 설정</span>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t border-line p-3 text-xs text-ink-3">
                <span className="num">{filtered.length}</span>개 포트
              </div>
            </div>
          </>
        )}
      </div>

      {/* 포트 연결 설정 모달 */}
      {connectingPort && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={() => setConnectingPort(null)}>
          <div className="bg-panel border border-line rounded-xl shadow-xl p-6 max-w-md w-full max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold">포트 연결 설정</h3>
                <p className="text-xs text-ink-3 mt-1">
                  {networkAssets.find((a: any) => a.id === connectingPort.asset_id)?.asset_name} — {connectingPort.port_name || `Port ${connectingPort.port_number}`}
                </p>
              </div>
              <button onClick={() => setConnectingPort(null)} className="text-ink-2 hover:text-ink"><X size={18} /></button>
            </div>

            {/* 현재 연결 해제 */}
            {connectingPort.connected_asset_name && (
              <div className="panel p-3 mb-4 flex items-center justify-between">
                <div className="text-sm">
                  <span className="text-signal font-medium">{connectingPort.connected_asset_name}</span>
                  <span className="text-ink-3 ml-1">· {connectingPort.connected_port_name}</span>
                </div>
                <button
                  onClick={() => connectPort(connectingPort.id, null)}
                  className="text-xs text-fault hover:underline"
                >연결 해제</button>
              </div>
            )}

            {/* 대상 포트 검색 + 선택 */}
            <input
              type="text"
              placeholder="장비 또는 포트 검색..."
              value={connectSearch}
              onChange={(e) => setConnectSearch(e.target.value)}
              className="form-input text-sm mb-3"
              autoFocus
            />
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {networkAssets
                .filter((a: any) => a.id !== connectingPort.asset_id)
                .map((asset: any) => {
                  const aPorts = allPorts.filter((p) => p.asset_id === asset.id);
                  if (aPorts.length === 0) return null;
                  const matchSearch = !connectSearch ||
                    asset.asset_name.toLowerCase().includes(connectSearch.toLowerCase()) ||
                    aPorts.some((p) => p.port_name.toLowerCase().includes(connectSearch.toLowerCase()));
                  if (!matchSearch) return null;
                  return (
                    <div key={asset.id}>
                      <div className="text-xs eyebrow text-ink-3 px-2 pt-2">{asset.asset_name}</div>
                      {aPorts
                        .filter((p) => !connectSearch || p.port_name.toLowerCase().includes(connectSearch.toLowerCase()) || asset.asset_name.toLowerCase().includes(connectSearch.toLowerCase()))
                        .map((p) => {
                          const isSelf = p.id === connectingPort.id;
                          const isConnected = p.connected_to_port_id !== null;
                          return (
                            <button
                              key={p.id}
                              disabled={isSelf}
                              onClick={() => connectPort(connectingPort.id, p.id)}
                              className={`w-full text-left px-3 py-1.5 text-sm rounded flex items-center justify-between ${
                                isSelf ? "opacity-30" : "hover:bg-surface"
                              }`}
                            >
                              <span className="num">{p.port_name || `Port ${p.port_number}`}</span>
                              <span className="text-xs text-ink-3">
                                {isConnected ? `→ ${p.connected_asset_name}` : "미연결"}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

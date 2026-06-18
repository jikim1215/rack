"use client";

import { useState } from "react";

const portStatusColors: Record<string, string> = {
  used: "bg-green-500",
  unused: "bg-slate-300",
  reserved: "bg-amber-400",
  disabled: "bg-red-500",
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
  connected_port_name: string | null;
  connected_asset_name: string | null;
  asset_name: string;
}

export function PortMapView({ networkAssets, ports }: { networkAssets: any[]; ports: Port[] }) {
  const [selectedAsset, setSelectedAsset] = useState<number | null>(networkAssets[0]?.id ?? null);
  const [statusFilter, setStatusFilter] = useState("");
  const [hoveredPort, setHoveredPort] = useState<Port | null>(null);

  const assetPorts = ports.filter((p) => p.asset_id === selectedAsset);
  const filtered = statusFilter ? assetPorts.filter((p) => p.status === statusFilter) : assetPorts;
  const selectedDevice = networkAssets.find((a: any) => a.id === selectedAsset);

  // 포트 통계
  const stats = {
    total: assetPorts.length,
    used: assetPorts.filter((p) => p.status === "used").length,
    unused: assetPorts.filter((p) => p.status === "unused").length,
    reserved: assetPorts.filter((p) => p.status === "reserved").length,
  };

  return (
    <div className="flex gap-6">
      {/* 장비 목록 */}
      <div className="w-64 shrink-0">
        <div className="bg-white border rounded-lg p-3">
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
                    selectedAsset === a.id ? "bg-blue-50 text-blue-700 font-medium" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="font-medium">{a.asset_name}</div>

                  <div className="text-xs text-slate-400">
                    {a.ip_address} · {usedCount}/{aPorts.length} 포트
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
            <div className="bg-white border rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-lg">{selectedDevice.asset_name}</h3>
                  <p className="text-sm text-slate-500">
                    {selectedDevice.manufacturer} {selectedDevice.model} · {selectedDevice.ip_address}
                  </p>
                  {selectedDevice.rack_name && (
                    <p className="text-xs text-slate-400 mt-1">
                      {selectedDevice.location_name} / {selectedDevice.rack_name}
                    </p>
                  )}
                </div>
                <div className="flex gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold">{stats.total}</div>
                    <div className="text-xs text-slate-500">전체</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-green-600">{stats.used}</div>
                    <div className="text-xs text-slate-500">사용중</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-slate-400">{stats.unused}</div>
                    <div className="text-xs text-slate-500">미사용</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-amber-500">{stats.reserved}</div>
                    <div className="text-xs text-slate-500">예약</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 필터 */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm text-slate-500">상태:</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setStatusFilter("")}
                  className={`px-3 py-1 rounded text-xs ${!statusFilter ? "bg-blue-600 text-white" : "bg-slate-100 hover:bg-slate-200"}`}
                >
                  전체
                </button>
                {Object.entries(portStatusLabels).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setStatusFilter(k)}
                    className={`px-3 py-1 rounded text-xs ${statusFilter === k ? "bg-blue-600 text-white" : "bg-slate-100 hover:bg-slate-200"}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* 포트 그리드 시각화 */}
            <div className="bg-white border rounded-lg p-4 mb-4">
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
                      <span className="text-[9px] font-bold text-white">{port.port_number}</span>
                      <span className="text-[7px] text-white/70">{portTypeLabels[port.port_type]?.slice(0, 3) || ""}</span>
                    </div>

                    {/* 포트 툴팁 */}
                    {hoveredPort?.id === port.id && (
                      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-900 text-white p-2.5 rounded-lg shadow-xl text-xs whitespace-nowrap pointer-events-none">
                        <div className="font-bold">{port.port_name || `Port ${port.port_number}`}</div>
                        <div className="text-slate-300 mt-1 space-y-0.5">
                          <div>유형: {portTypeLabels[port.port_type] || port.port_type}</div>
                          <div>속도: {port.speed || "-"}</div>
                          <div>상태: {portStatusLabels[port.status]}</div>
                          {port.vlan && <div>VLAN: {port.vlan}</div>}
                          {port.connected_asset_name && (
                            <div className="text-green-400">
                              → {port.connected_asset_name} ({port.connected_port_name})
                            </div>
                          )}
                        </div>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 포트 상세 테이블 */}
            <div className="bg-white border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b text-left text-slate-600">
                    <th className="p-3">포트</th>
                    <th className="p-3">이름</th>
                    <th className="p-3">유형</th>
                    <th className="p-3">속도</th>
                    <th className="p-3">VLAN</th>
                    <th className="p-3">상태</th>
                    <th className="p-3">연결 대상</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((port) => (
                    <tr key={port.id} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="p-3 font-mono">{port.port_number}</td>
                      <td className="p-3 font-medium">{port.port_name}</td>
                      <td className="p-3 text-slate-500">{portTypeLabels[port.port_type] || port.port_type}</td>
                      <td className="p-3 text-slate-500">{port.speed || "-"}</td>
                      <td className="p-3 font-mono text-xs">{port.vlan || "-"}</td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1 text-xs`}>
                          <span className={`w-2 h-2 rounded-full ${portStatusColors[port.status]}`} />
                          {portStatusLabels[port.status]}
                        </span>
                      </td>
                      <td className="p-3 text-xs">
                        {port.connected_asset_name ? (
                          <span className="text-green-600">{port.connected_asset_name} · {port.connected_port_name}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="border-t p-3 text-xs text-slate-400">
                {filtered.length}개 포트
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

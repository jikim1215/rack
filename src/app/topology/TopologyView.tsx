'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import { Network, Server, Shield, Phone } from 'lucide-react';

interface Asset {
  id: number;
  asset_name: string;
  asset_type: string;
  ip_address: string;
  status: string;
}

interface Connection {
  id: number;
  asset_id: number;
  port_name: string;
  connected_to_port_id: number;
  connected_asset_id: number;
}

interface Props {
  assets: Asset[];
  connections: Connection[];
}

const typeColors: Record<string, string> = {
  network: '#22c55e',
  server: '#3b82f6',
  security: '#ef4444',
  telecom: '#f97316',
};

const typeLabels: Record<string, string> = {
  network: '네트워크',
  server: '서버',
  security: '보안',
  telecom: '통신',
};

const typeIcons: Record<string, typeof Network> = {
  network: Network,
  server: Server,
  security: Shield,
  telecom: Phone,
};

const statusLabels: Record<string, string> = {
  active: '운용중',
  inactive: '미사용',
  maintenance: '점검중',
  decommissioned: '폐기',
  eos: 'EoS(단종)',
};

const statusColors: Record<string, string> = {
  active: '#22c55e',
  inactive: '#6b7280',
  maintenance: '#f59e0b',
  decommissioned: '#ef4444',
  eos: '#a855f7',
};

const NODE_W = 140;
const NODE_H = 60;
const GAP_X = 200;
const GAP_Y = 80;
const PAD = 40;

export function TopologyView({ assets, connections }: Props) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.min(Math.max(0.3, z + delta), 3));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: panStart.current.panX + (e.clientX - panStart.current.x),
      y: panStart.current.panY + (e.clientY - panStart.current.y),
    });
  }, [isPanning]);

  const handleMouseUp = useCallback(() => setIsPanning(false), []);
  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  const { layers, standalone, edges, connectedIds } = useMemo(() => {
    // Build adjacency from connections
    const adj = new Map<number, Set<number>>();
    const edgeList: { from: number; to: number }[] = [];
    const seen = new Set<string>();

    for (const c of connections) {
      if (!c.connected_asset_id || c.asset_id === c.connected_asset_id) continue;
      const key = [Math.min(c.asset_id, c.connected_asset_id), Math.max(c.asset_id, c.connected_asset_id)].join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      edgeList.push({ from: c.asset_id, to: c.connected_asset_id });
      if (!adj.has(c.asset_id)) adj.set(c.asset_id, new Set());
      if (!adj.has(c.connected_asset_id)) adj.set(c.connected_asset_id, new Set());
      adj.get(c.asset_id)!.add(c.connected_asset_id);
      adj.get(c.connected_asset_id)!.add(c.asset_id);
    }

    const connIds = new Set(Array.from(adj.keys()));
    const assetMap = new Map(assets.map(a => [a.id, a]));

    // Find root: most connections
    let root: number | null = null;
    let maxConn = 0;
    for (const [id, neighbors] of Array.from(adj)) {
      if (neighbors.size > maxConn) {
        maxConn = neighbors.size;
        root = id;
      }
    }

    // BFS layers
    const layers: number[][] = [];
    const visited = new Set<number>();
    if (root !== null) {
      const queue: number[] = [root];
      visited.add(root);
      while (queue.length > 0) {
        const layer = [...queue];
        layers.push(layer);
        const next: number[] = [];
        for (const id of layer) {
          for (const neighbor of Array.from(adj.get(id) || [])) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              next.push(neighbor);
            }
          }
        }
        queue.length = 0;
        queue.push(...next);
      }
    }

    // Standalone: assets not in any connection
    const standalone = assets.filter(a => !connIds.has(a.id));

    return { layers, standalone, edges: edgeList, connectedIds: connIds };
  }, [assets, connections]);

  // Compute node positions
  const positions = useMemo(() => {
    const pos = new Map<number, { x: number; y: number }>();

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const totalHeight = layer.length * NODE_H + (layer.length - 1) * GAP_Y;
      const startY = PAD + (layer.length > 1 ? 0 : totalHeight / 2);
      for (let ni = 0; ni < layer.length; ni++) {
        pos.set(layer[ni], {
          x: PAD + li * (NODE_W + GAP_X),
          y: startY + ni * (NODE_H + GAP_Y),
        });
      }
    }

    // Standalone nodes on the right
    const maxLayerX = layers.length > 0 ? PAD + layers.length * (NODE_W + GAP_X) : PAD;
    for (let i = 0; i < standalone.length; i++) {
      pos.set(standalone[i].id, {
        x: maxLayerX,
        y: PAD + i * (NODE_H + GAP_Y),
      });
    }

    return pos;
  }, [layers, standalone]);

  const assetMap = useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);

  // Hover-related edges & nodes
  const highlightedNodes = useMemo(() => {
    if (hoveredId === null) return new Set<number>();
    const s = new Set<number>([hoveredId]);
    for (const e of edges) {
      if (e.from === hoveredId) s.add(e.to);
      if (e.to === hoveredId) s.add(e.from);
    }
    return s;
  }, [hoveredId, edges]);

  // SVG dimensions
  const svgW = useMemo(() => {
    let max = 0;
    for (const p of Array.from(positions.values())) {
      if (p.x + NODE_W + PAD > max) max = p.x + NODE_W + PAD;
    }
    return Math.max(max, 400);
  }, [positions]);

  const svgH = useMemo(() => {
    let max = 0;
    for (const p of Array.from(positions.values())) {
      if (p.y + NODE_H + PAD > max) max = p.y + NODE_H + PAD;
    }
    return Math.max(max, 300);
  }, [positions]);

  const totalConnections = edges.length;
  const totalAssets = assets.length;
  const typeCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of assets) m[a.asset_type] = (m[a.asset_type] || 0) + 1;
    return m;
  }, [assets]);

  return (
    <div className="space-y-4">
      {/* Header stats & legend */}
      <div className="panel p-4 flex flex-wrap items-center gap-6">
        <div className="text-sm text-ink-2">
          전체 자산 <span className="num font-bold text-ink">{totalAssets}</span>대
          {' · '}
          연결 <span className="num font-bold text-ink">{totalConnections}</span>건
        </div>
        <div className="flex items-center gap-4 ml-auto">
          {Object.entries(typeColors).map(([type, color]) => {
            const Icon = typeIcons[type];
            return (
              <div key={type} className="flex items-center gap-1.5 text-sm text-ink-2">
                <Icon size={16} style={{ color }} />
                <span>{typeLabels[type]}</span>
                <span className="num text-ink-3">({typeCounts[type] || 0})</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* SVG canvas — zoom/pan */}
      <div className="panel overflow-hidden relative" style={{ minHeight: 400 }}>
        {/* 줌 컨트롤 */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 text-xs">
          <button onClick={() => setZoom(z => Math.min(3, z + 0.2))} className="btn-ink px-2 py-1">+</button>
          <span className="num text-ink-3 px-1">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.max(0.3, z - 0.2))} className="btn-ink px-2 py-1">−</button>
          <button onClick={resetView} className="btn-ink px-2 py-1 ml-1">↺</button>
        </div>
        {assets.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-ink-3">
            표시할 자산이 없습니다.
          </div>
        ) : (
          <div
            ref={containerRef}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              cursor: isPanning ? 'grabbing' : 'grab',
              overflow: 'hidden',
              height: 'clamp(400px, 70vh, 900px)',
            }}
          >
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            width={svgW}
            height={svgH}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              transition: isPanning ? 'none' : 'transform 0.1s ease-out',
            }}
          >
            {/* Edges */}
            {edges.map((e, i) => {
              const from = positions.get(e.from);
              const to = positions.get(e.to);
              if (!from || !to) return null;
              const isHighlighted = hoveredId !== null && (e.from === hoveredId || e.to === hoveredId);
              const dimmed = hoveredId !== null && !isHighlighted;
              return (
                <line
                  key={`edge-${i}`}
                  x1={from.x + NODE_W}
                  y1={from.y + NODE_H / 2}
                  x2={to.x}
                  y2={to.y + NODE_H / 2}
                  stroke={isHighlighted ? '#2563eb' : '#d1d5db'}
                  strokeWidth={isHighlighted ? 2.5 : 1.5}
                  opacity={dimmed ? 0.15 : 1}
                  style={{ transition: 'opacity 0.15s, stroke 0.15s' }}
                />
              );
            })}

            {/* Standalone label */}
            {standalone.length > 0 && (() => {
              const firstPos = positions.get(standalone[0].id);
              if (!firstPos) return null;
              return (
                <text
                  x={firstPos.x + NODE_W / 2}
                  y={firstPos.y - 12}
                  textAnchor="middle"
                  fontSize={12}
                  fill="#9ca3af"
                  fontWeight={600}
                >
                  Standalone
                </text>
              );
            })()}

            {/* Layer labels */}
            {layers.map((layer, li) => {
              const pos = positions.get(layer[0]);
              if (!pos) return null;
              const label = li === 0 ? 'Core' : `Layer ${li}`;
              return (
                <text
                  key={`label-${li}`}
                  x={pos.x + NODE_W / 2}
                  y={pos.y - 12}
                  textAnchor="middle"
                  fontSize={12}
                  fill="#9ca3af"
                  fontWeight={600}
                >
                  {label}
                </text>
              );
            })}

            {/* Nodes */}
            {Array.from(positions.entries()).map(([id, pos]) => {
              const asset = assetMap.get(id);
              if (!asset) return null;
              const color = typeColors[asset.asset_type] || '#6b7280';
              const isHovered = hoveredId === id;
              const dimmed = hoveredId !== null && !highlightedNodes.has(id);
              return (
                <g
                  key={id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onMouseEnter={() => setHoveredId(id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
                  opacity={dimmed ? 0.2 : 1}
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={6}
                    fill="white"
                    stroke={isHovered ? color : '#e5e7eb'}
                    strokeWidth={isHovered ? 2.5 : 1.5}
                  />
                  {/* Top color bar */}
                  <rect
                    width={NODE_W}
                    height={4}
                    rx={2}
                    fill={color}
                    clipPath={`inset(0 0 0 0 round 6px 6px 0 0)`}
                  />
                  {/* Asset name */}
                  <text
                    x={NODE_W / 2}
                    y={20}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill="#111827"
                  >
                    {asset.asset_name.length > 16
                      ? asset.asset_name.slice(0, 15) + '…'
                      : asset.asset_name}
                  </text>
                  {/* Type badge */}
                  <rect
                    x={NODE_W / 2 - 22}
                    y={27}
                    width={44}
                    height={14}
                    rx={3}
                    fill={color}
                    opacity={0.15}
                  />
                  <text
                    x={NODE_W / 2}
                    y={37}
                    textAnchor="middle"
                    fontSize={9}
                    fill={color}
                    fontWeight={500}
                  >
                    {typeLabels[asset.asset_type] || asset.asset_type}
                  </text>
                  {/* IP + status */}
                  <text
                    x={NODE_W / 2}
                    y={52}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#6b7280"
                  >
                    {asset.ip_address || '-'}
                    {'  '}
                    <tspan fill={statusColors[asset.status] || '#6b7280'}>
                      ●
                    </tspan>
                    {' '}
                    {statusLabels[asset.status] || asset.status}
                  </text>
                </g>
              );
            })}
          </svg>
          </div>
        )}
      </div>
    </div>
  );
}

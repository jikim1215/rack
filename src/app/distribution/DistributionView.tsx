"use client";

import { useState, useMemo } from "react";
import { GitBranch, Search, Save, X } from "lucide-react";

const pairStatusColors: Record<string, string> = {
  used: "bg-blue-500 text-white",
  unused: "bg-slate-200 text-slate-600",
  reserved: "bg-amber-400 text-white",
  faulty: "bg-red-500 text-white",
};
const pairStatusLabels: Record<string, string> = {
  used: "사용중",
  unused: "미사용",
  reserved: "예약",
  faulty: "장애",
};
const frameTypeLabels: Record<string, string> = {
  "110block": "110블록",
  patch_panel: "패치패널",
  optical: "광패널",
  other: "기타",
};

interface Pair {
  id: number;
  frame_id: number;
  pair_number: number;
  status: string;
  label: string;
  source: string;
  destination: string;
  cable_id: string;
  user_info: string;
  description: string;
}

interface Frame {
  id: number;
  location_id: number;
  rack_id: number | null;
  name: string;
  frame_type: string;
  total_pairs: number;
  description: string;
  location_name: string;
  building: string;
  floor: string;
  room: string;
}

interface Props {
  frames: Frame[];
  pairs: Pair[];
  buildings: string[];
}

export function DistributionView({ frames, pairs: initialPairs, buildings }: Props) {
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [pairsState, setPairsState] = useState<Pair[]>(initialPairs);
  const [editingPair, setEditingPair] = useState<Pair | null>(null);
  const [hoveredPair, setHoveredPair] = useState<Pair | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // 건물→층 트리 구성
  const buildingTree = useMemo(() => {
    const tree: Record<string, string[]> = {};
    for (const f of frames) {
      const b = f.building || "미지정";
      if (!tree[b]) tree[b] = [];
      if (f.floor && !tree[b].includes(f.floor)) tree[b].push(f.floor);
    }
    // 층 정렬
    for (const b of Object.keys(tree)) {
      tree[b].sort((a, c) => {
        const order = (v: string) => {
          if (v.startsWith("B")) return -100 + parseInt(v.slice(1) || "0");
          return parseInt(v.replace(/[^0-9-]/g, "") || "0");
        };
        return order(a) - order(c);
      });
    }
    return tree;
  }, [frames]);

  // 필터링된 배선반
  const filteredFrames = useMemo(() => {
    let result = frames;
    if (selectedBuilding) {
      result = result.filter((f) => (f.building || "미지정") === selectedBuilding);
      if (selectedFloor) {
        result = result.filter((f) => f.floor === selectedFloor);
      }
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.location_name?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [frames, selectedBuilding, selectedFloor, searchQuery]);

  // 선택된 배선반의 페어
  const framePairs = useMemo(() => {
    if (!selectedFrame) return [];
    return pairsState.filter((p) => p.frame_id === selectedFrame).sort((a, b) => a.pair_number - b.pair_number);
  }, [selectedFrame, pairsState]);

  const currentFrame = frames.find((f) => f.id === selectedFrame);

  // 전체 통계
  const stats = useMemo(() => {
    return {
      totalFrames: frames.length,
      totalPairs: pairsState.length,
      used: pairsState.filter((p) => p.status === "used").length,
      unused: pairsState.filter((p) => p.status === "unused").length,
      reserved: pairsState.filter((p) => p.status === "reserved").length,
      faulty: pairsState.filter((p) => p.status === "faulty").length,
    };
  }, [frames, pairsState]);

  // 배선반별 사용률
  const frameUsage = (frameId: number) => {
    const fp = pairsState.filter((p) => p.frame_id === frameId);
    const used = fp.filter((p) => p.status === "used").length;
    const total = fp.length || frames.find((f) => f.id === frameId)?.total_pairs || 50;
    return { used, total, pct: total > 0 ? Math.round((used / total) * 100) : 0 };
  };

  // 편집 저장
  const handleSave = async () => {
    if (!editingPair || !selectedFrame) return;
    setSaving(true);
    try {
      const framePairsToSave = pairsState
        .filter((p) => p.frame_id === selectedFrame)
        .map((p) => (p.id === editingPair.id ? editingPair : p));

      const res = await fetch(`/api/frames/${selectedFrame}/pairs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(framePairsToSave),
      });
      if (res.ok) {
        setPairsState((prev) =>
          prev.map((p) => (p.id === editingPair.id ? editingPair : p))
        );
        setEditingPair(null);
      }
    } finally {
      setSaving(false);
    }
  };

  // 그리드 열 수 (10열 기준)
  const gridCols = 10;

  return (
    <div>
      {/* 상단 통계 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <div className="bg-white border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-slate-800">{stats.totalFrames}</div>
          <div className="text-xs text-slate-500">전체 배선반</div>
        </div>
        <div className="bg-white border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-slate-800">{stats.totalPairs}</div>
          <div className="text-xs text-slate-500">전체 페어</div>
        </div>
        <div className="bg-white border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{stats.used}</div>
          <div className="text-xs text-slate-500">사용중</div>
        </div>
        <div className="bg-white border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-slate-400">{stats.unused}</div>
          <div className="text-xs text-slate-500">미사용</div>
        </div>
        <div className="bg-white border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-amber-500">{stats.reserved}</div>
          <div className="text-xs text-slate-500">예약</div>
        </div>
        <div className="bg-white border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-red-500">{stats.faulty}</div>
          <div className="text-xs text-slate-500">장애</div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* 좌측 트리 네비게이션 */}
        <div className="w-[250px] shrink-0">
          <div className="bg-white border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <GitBranch className="w-4 h-4 text-slate-500" />
              <h3 className="font-semibold text-sm">건물 / 층</h3>
            </div>

            {/* 검색 */}
            <div className="relative mb-3">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="배선반 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input pl-7 text-xs w-full"
              />
            </div>

            <div className="space-y-1">
              {/* 전체 */}
              <button
                onClick={() => { setSelectedBuilding(null); setSelectedFloor(null); }}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  !selectedBuilding ? "bg-blue-50 text-blue-700 font-medium" : "hover:bg-slate-50"
                }`}
              >
                전체 ({frames.length})
              </button>

              {/* 건물별 */}
              {(buildings.length > 0 ? buildings : Object.keys(buildingTree)).map((b) => (
                <div key={b}>
                  <button
                    onClick={() => {
                      setSelectedBuilding(b);
                      setSelectedFloor(null);
                    }}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors font-medium ${
                      selectedBuilding === b && !selectedFloor
                        ? "bg-blue-50 text-blue-700"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    {b}
                  </button>
                  {/* 층 목록 */}
                  {selectedBuilding === b && buildingTree[b]?.map((floor) => (
                    <button
                      key={floor}
                      onClick={() => setSelectedFloor(floor)}
                      className={`w-full text-left pl-7 pr-3 py-1.5 rounded text-sm transition-colors ${
                        selectedFloor === floor
                          ? "bg-blue-50 text-blue-700 font-medium"
                          : "hover:bg-slate-50 text-slate-600"
                      }`}
                    >
                      {floor}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 우측 영역 */}
        <div className="flex-1 min-w-0">
          {/* 배선반 카드 목록 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {filteredFrames.map((f) => {
              const usage = frameUsage(f.id);
              return (
                <button
                  key={f.id}
                  onClick={() => setSelectedFrame(f.id)}
                  className={`bg-white border rounded-lg p-5 text-left transition-all hover:shadow-md ${
                    selectedFrame === f.id ? "ring-2 ring-blue-500 border-blue-300" : ""
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="font-semibold text-sm">{f.name}</div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                      {frameTypeLabels[f.frame_type] || f.frame_type}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mb-3">
                    {[f.building, f.floor, f.room].filter(Boolean).join(" · ") || f.location_name || "위치 미지정"}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{ width: `${usage.pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-500 whitespace-nowrap">
                      {usage.used}/{usage.total} ({usage.pct}%)
                    </span>
                  </div>
                </button>
              );
            })}
            {filteredFrames.length === 0 && (
              <div className="col-span-full text-center text-slate-400 py-12">
                해당 위치에 배선반이 없습니다.
              </div>
            )}
          </div>

          {/* 110블록 페어 그리드 */}
          {currentFrame && (
            <div className="bg-white border rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">
                  {currentFrame.name} — 페어 그리드
                  <span className="text-xs font-normal text-slate-500 ml-2">
                    ({currentFrame.total_pairs}페어)
                  </span>
                </h3>
                <div className="flex items-center gap-3 text-xs">
                  {Object.entries(pairStatusColors).map(([status, cls]) => (
                    <span key={status} className="flex items-center gap-1">
                      <span className={`w-3 h-3 rounded ${cls.split(" ")[0]}`} />
                      {pairStatusLabels[status]}
                    </span>
                  ))}
                </div>
              </div>

              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: currentFrame.total_pairs }, (_, i) => {
                  const pairNum = i + 1;
                  const pair = framePairs.find((p) => p.pair_number === pairNum);
                  const status = pair?.status || "unused";
                  const colorCls = pairStatusColors[status] || pairStatusColors.unused;

                  return (
                    <div
                      key={pairNum}
                      className={`relative w-9 h-9 rounded flex items-center justify-center cursor-pointer transition-transform hover:scale-110 ${colorCls}`}
                      onMouseEnter={() => pair && setHoveredPair(pair)}
                      onMouseLeave={() => setHoveredPair(null)}
                      onClick={() => {
                        if (pair) {
                          setEditingPair({ ...pair });
                        } else {
                          // 빈 페어 클릭 시 새 항목
                          setEditingPair({
                            id: 0,
                            frame_id: currentFrame.id,
                            pair_number: pairNum,
                            status: "unused",
                            label: "",
                            source: "",
                            destination: "",
                            cable_id: "",
                            user_info: "",
                            description: "",
                          });
                        }
                      }}
                    >
                      <span className="text-[9px] font-medium leading-none">{pairNum}</span>

                      {/* 툴팁 */}
                      {hoveredPair?.pair_number === pairNum && pair && (
                        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-800 text-white text-[11px] rounded-lg p-2.5 shadow-lg pointer-events-none">
                          <div className="font-semibold mb-1">페어 #{pair.pair_number}</div>
                          <div>상태: {pairStatusLabels[pair.status]}</div>
                          {pair.label && <div>라벨: {pair.label}</div>}
                          {(pair.source || pair.destination) && (
                            <div>{pair.source || "?"} → {pair.destination || "?"}</div>
                          )}
                          {pair.cable_id && <div>케이블: {pair.cable_id}</div>}
                          {pair.user_info && <div>사용자: {pair.user_info}</div>}
                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 편집 모달 */}
      {editingPair && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">
                페어 #{editingPair.pair_number} 편집
              </h3>
              <button onClick={() => setEditingPair(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">상태</label>
                <select
                  className="form-input w-full"
                  value={editingPair.status}
                  onChange={(e) => setEditingPair({ ...editingPair, status: e.target.value })}
                >
                  {Object.entries(pairStatusLabels).map(([val, lbl]) => (
                    <option key={val} value={val}>{lbl}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">라벨</label>
                <input
                  className="form-input w-full"
                  value={editingPair.label}
                  onChange={(e) => setEditingPair({ ...editingPair, label: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">소스</label>
                  <input
                    className="form-input w-full"
                    value={editingPair.source}
                    onChange={(e) => setEditingPair({ ...editingPair, source: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">목적지</label>
                  <input
                    className="form-input w-full"
                    value={editingPair.destination}
                    onChange={(e) => setEditingPair({ ...editingPair, destination: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">케이블 ID</label>
                <input
                  className="form-input w-full"
                  value={editingPair.cable_id}
                  onChange={(e) => setEditingPair({ ...editingPair, cable_id: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">사용자 정보</label>
                <input
                  className="form-input w-full"
                  value={editingPair.user_info}
                  onChange={(e) => setEditingPair({ ...editingPair, user_info: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setEditingPair(null)}
                className="px-4 py-2 text-sm text-slate-600 border rounded-lg hover:bg-slate-50"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? "저장중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

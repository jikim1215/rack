"use client";

import { useState, useMemo, useRef } from "react";
import { GitBranch, Search, Save, X, Link2, Unlink, ArrowRight, Download, Upload, Route } from "lucide-react";
import { useToast } from "@/components/Toast";
import { UsageGuide } from "@/components/UsageGuide";

const pairStatusColors: Record<string, string> = {
  used: "bg-signal text-white",
  unused: "bg-slate-200 text-slate-600",
  reserved: "bg-warn text-white",
  faulty: "bg-fault text-white",
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

// ── 심선/코어 색코드 (표기용) ──
// 110블록(25페어): 팁 5색 × 링 5색 / 광(12색) 표준
const TIP5 = ["화이트", "레드", "블랙", "옐로", "바이올렛"];
const RING5 = ["블루", "오렌지", "그린", "브라운", "슬레이트"];
const FIBER12 = ["파랑", "주황", "녹색", "갈색", "회색", "흰색", "빨강", "검정", "노랑", "보라", "분홍", "청록"];
function colorCodeOf(frameType: string, n: number): string {
  if (!n || n < 1) return "";
  if (frameType === "optical") {
    const idx = (n - 1) % 12;
    const tube = Math.floor((n - 1) / 12) + 1;
    return `${tube}튜브-${FIBER12[idx]}`;
  }
  // 110블록/패치패널: 25페어 색코드
  const i = (n - 1) % 25;
  return `${TIP5[Math.floor(i / 5)]}-${RING5[i % 5]}`;
}

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
  core_number?: number | null;
  linked_pair_id?: number | null;
  connected_port_id?: number | null;
  linked_pair_number?: number | null;
  linked_frame_id?: number | null;
  linked_frame_name?: string | null;
  connected_port_number?: number | null;
  connected_port_name?: string | null;
  connected_asset_name?: string | null;
}

interface Frame {
  id: number;
  location_id: number;
  rack_id: number | null;
  frame_name: string;

  frame_type: string;
  total_pairs: number;
  description: string;
  location_name: string;
  building: string;
  floor: string;
  room: string;
  team_id?: number | null;
  owner_team_name?: string | null;
}

interface Props {
  frames: Frame[];
  pairs: Pair[];
  buildings: string[];
  initialFrameId?: number | null;
}

export function DistributionView({ frames, pairs: initialPairs, buildings, initialFrameId = null }: Props) {
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<number | null>(
    initialFrameId && frames.some((f) => f.id === initialFrameId) ? initialFrameId : null
  );
  const [pairsState, setPairsState] = useState<Pair[]>(initialPairs);
  const [editingPair, setEditingPair] = useState<Pair | null>(null);
  const [hoveredPair, setHoveredPair] = useState<Pair | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { addToast } = useToast();
  // 대향 연결 폼 (편집 모달 내)
  const [linkFrameId, setLinkFrameId] = useState<number | "">("");
  const [linkPairNo, setLinkPairNo] = useState("");
  const [linking, setLinking] = useState(false);
  // 선번 추적
  const [traceQ, setTraceQ] = useState("");
  const [traceResults, setTraceResults] = useState<any[] | null>(null);
  const [tracing, setTracing] = useState(false);
  // 선번장 업로드
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // 배선반 일괄 등록 업로드
  const bulkUploadRef = useRef<HTMLInputElement>(null);
  const [bulkUploading, setBulkUploading] = useState(false);

  // 특정 프레임들의 페어를 서버에서 다시 읽어 상태 병합 (링크/업로드 후 동기화)
  async function reloadPairs(frameIds: number[]) {
    const results = await Promise.all(
      frameIds.map(async (fid) => {
        const res = await fetch(`/api/frames/${fid}/pairs`);
        if (!res.ok) {
          // 실패한 프레임은 기존 화면 상태를 유지하고 사용자에게 알린다
          addToast(`배선반 #${fid} 페어 갱신에 실패했습니다.`, "error");
          return { fid, pairs: null as Pair[] | null };
        }
        return { fid, pairs: (await res.json()) as Pair[] };
      })
    );
    setPairsState((prev) => {
      let next = prev;
      for (const { fid, pairs } of results) {
        if (!pairs) continue;
        next = [...next.filter((p) => p.frame_id !== fid), ...pairs];
      }
      return next;
    });
  }

  async function linkPair(pair: Pair) {
    if (!linkFrameId || !linkPairNo) { addToast("대향 배선반과 포트 번호를 선택하세요.", "error"); return; }
    const target = pairsState.find((p) => p.frame_id === linkFrameId && p.pair_number === Number(linkPairNo));
    if (!target) { addToast(`대향 배선반에 #${linkPairNo} 페어가 없습니다.`, "error"); return; }
    setLinking(true);
    try {
      const res = await fetch("/api/frames/pairs/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pair_a_id: pair.id, pair_b_id: target.id }),
      });
      const data = await res.json();
      if (res.ok) {
        addToast("대향 연결 완료 — 반대쪽 선번장에도 자동 반영되었습니다.", "success");
        await reloadPairs([pair.frame_id, target.frame_id]);
        setEditingPair(null);
        setLinkFrameId(""); setLinkPairNo("");
      } else {
        addToast(data.error || "연결에 실패했습니다.", "error");
      }
    } finally {
      setLinking(false);
    }
  }

  async function unlinkPair(pair: Pair) {
    setLinking(true);
    try {
      const res = await fetch("/api/frames/pairs/link", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pair_id: pair.id }),
      });
      const data = await res.json();
      if (res.ok) {
        addToast("대향 연결이 해제되었습니다 (양쪽 모두).", "success");
        await reloadPairs([pair.frame_id, ...(pair.linked_frame_id ? [pair.linked_frame_id] : [])]);
        setEditingPair(null);
      } else {
        addToast(data.error || "해제에 실패했습니다.", "error");
      }
    } finally {
      setLinking(false);
    }
  }

  function jumpToPair(frameId: number | null | undefined) {
    if (!frameId) return;
    const f = frames.find((x) => x.id === frameId);
    if (!f) { addToast("대향 배선반을 찾을 수 없습니다.", "error"); return; }
    setSelectedBuilding(null); setSelectedFloor(null);
    setSelectedFrame(frameId);
    setEditingPair(null);
    setTraceResults(null);
  }

  async function runTrace() {
    const q = traceQ.trim();
    if (!q) { setTraceResults(null); return; }
    setTracing(true);
    try {
      const res = await fetch(`/api/frames/trace?q=${encodeURIComponent(q)}`);
      setTraceResults(res.ok ? await res.json() : []);
    } finally {
      setTracing(false);
    }
  }

  async function uploadLedger(file: File) {
    if (!selectedFrame) return;
    // 병합 규칙 사전 고지 (외부 검토 R6-4 합의): 저빈도 화면일수록 업로드 동작 예측 가능해야 한다
    const fname = frames.find((f) => f.id === selectedFrame)?.frame_name || "선택한 프레임";
    if (!confirm(`'${fname}' 선번장을 업로드합니다.\n\n병합 규칙:\n· 셀 단위 병합 — 엑셀의 빈 셀은 기존 값을 지우지 않습니다\n· 값이 있는 셀만 갱신되며, 기존 값과 어긋나는 셀은 이슈로 보고됩니다\n· 대향 연결(링크)도 함께 반영됩니다\n\n계속하시겠습니까?`)) {
      if (uploadRef.current) uploadRef.current.value = "";
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/frames/${selectedFrame}/ledger`, { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        addToast(`선번장 반영: ${data.updated}행 갱신 · 링크 ${data.linked}건${data.issues.length ? ` · 이슈 ${data.issues.length}건` : ""}`, data.issues.length ? "info" : "success");
        for (const msg of data.issues.slice(0, 5)) addToast(msg, "error");
        // 링크가 갱신됐을 수 있으니 전체 다시 로드
        await reloadPairs([...new Set(pairsState.map((p) => p.frame_id))]);
      } else {
        addToast(data.error || "업로드에 실패했습니다.", "error");
      }
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  // 배선반 일괄 등록 (양식 업로드) — 프레임 목록은 서버 props라 성공 시 새로고침
  async function uploadFramesBulk(file: File) {
    setBulkUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/frames/bulk", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        addToast(`배선반 일괄 등록: ${data.created}건 생성 · ${data.skipped}건 건너뜀${data.issues.length ? ` · 이슈 ${data.issues.length}건` : ""}`, data.issues.length ? "info" : "success");
        for (const msg of data.issues.slice(0, 5)) addToast(msg, "error");
        if (data.created > 0) {
          // 새 프레임/페어는 서버 컴포넌트 props로 내려오므로 잠시 후 새로고침
          setTimeout(() => location.reload(), 1200);
        }
      } else {
        addToast(data.error || "일괄 등록에 실패했습니다.", "error");
      }
    } finally {
      setBulkUploading(false);
      if (bulkUploadRef.current) bulkUploadRef.current.value = "";
    }
  }

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
          f.frame_name.toLowerCase().includes(q) ||

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
        .map((p) => (p.pair_number === editingPair.pair_number ? editingPair : p));
      // 빈 슬롯(신규) 편집이면 목록에 추가
      if (!framePairsToSave.some((p) => p.pair_number === editingPair.pair_number)) {
        framePairsToSave.push(editingPair);
      }

      const res = await fetch(`/api/frames/${selectedFrame}/pairs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(framePairsToSave),
      });
      if (res.ok) {
        const fresh = await res.json();
        setPairsState((prev) => [...prev.filter((p) => p.frame_id !== selectedFrame), ...fresh]);
        setEditingPair(null);
        addToast("저장되었습니다.", "success");
      } else {
        const err = await res.json().catch(() => ({}));
        addToast(err.error || "저장에 실패했습니다.", "error");
      }
    } finally {
      setSaving(false);
    }
  };

  // 그리드 열 수 (10열 기준)
  const gridCols = 10;

  return (
    <div>
      {/* 사용 가이드 (접기/펼치기) */}
      <UsageGuide
        className="mb-4 text-right"
        items={[
          <>배선반(FDF/110블록)의 <strong className="text-ink-2">페어(포트) 단위</strong>로 선번을 관리합니다 — 칸을 클릭하면 편집</>,
          <><strong className="text-ink-2">대향 연결</strong>을 맺으면 반대쪽 선번장에 자동 반영됩니다(양단 대사) — 같은 유형끼리만 연결됩니다</>,
          <>상단 <strong className="text-ink-2">선번 추적</strong>에 케이블ID·장비명·IP·코어번호 등 아무거나 검색하면 양단 경로가 한 줄로 나옵니다</>,
          <><strong className="text-ink-2">선번장</strong> 버튼으로 엑셀 다운로드 → 작성 → 업로드하면 대향 연결까지 일괄 반영됩니다</>,
          <>랙 실장도에서 FDF 블록을 <strong className="text-ink-2">우클릭</strong>하면 이 화면으로 바로 점프합니다</>,
        ]}
      />
      {/* 선번 추적 — 라벨/케이블/코어/장비/IP 무엇으로든 경로를 찾는다 */}
      <div className="panel p-4 mb-6">
        <div className="flex items-center gap-2">
          <Route className="w-4 h-4 text-ink-3 shrink-0" />
          <input
            type="text"
            placeholder="선번 추적 — 케이블ID, 라벨, 코어번호, 장비명, IP, 사용자로 검색..."
            value={traceQ}
            onChange={(e) => setTraceQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runTrace(); }}
            className="form-input flex-1 text-sm"
          />
          <button onClick={runTrace} disabled={tracing} className="btn-ink px-4 py-2 text-sm disabled:opacity-50">
            {tracing ? "검색중..." : "추적"}
          </button>
          {traceResults !== null && (
            <button onClick={() => { setTraceResults(null); setTraceQ(""); }} className="px-3 py-2 border border-line rounded text-sm text-ink-2 hover:bg-slate-100">닫기</button>
          )}
        </div>
        {traceResults !== null && (
          <div className="mt-3 space-y-2">
            {traceResults.length === 0 && <p className="text-sm text-ink-3">일치하는 선번이 없습니다.</p>}
            {traceResults.map((t: any) => (
              <div key={t.id} className="border border-line rounded-lg p-3 text-sm flex flex-wrap items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${t.status === "used" ? "bg-signal" : t.status === "faulty" ? "bg-fault" : t.status === "reserved" ? "bg-warn" : "bg-slate-300"}`} />
                {t.a_asset_name && (
                  <>
                    <span className="text-ink-2">{t.a_asset_name}{t.a_port_name ? ` (${t.a_port_name})` : ""}</span>
                    <ArrowRight size={12} className="text-ink-3" />
                  </>
                )}
                <button onClick={() => jumpToPair(t.frame_id)} className="font-medium text-ink hover:underline">
                  {t.frame_name} <span className="num">#{t.pair_number}</span>
                </button>
                {t.linked_frame_name ? (
                  <>
                    <span className="text-ink-3 text-xs num">
                      ─{t.cable_id ? ` ${t.cable_id}` : ""}{t.core_number ? ` C${t.core_number}` : ""} ─
                    </span>
                    <button onClick={() => jumpToPair(t.linked_frame_id)} className="font-medium text-ink hover:underline">
                      {t.linked_frame_name} <span className="num">#{t.linked_pair_number}</span>
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-ink-3">(대향 미연결)</span>
                )}
                {t.b_asset_name && (
                  <>
                    <ArrowRight size={12} className="text-ink-3" />
                    <span className="text-ink-2">{t.b_asset_name}{t.b_port_name ? ` (${t.b_port_name})` : ""}</span>
                  </>
                )}
                <span className="ml-auto text-xs text-ink-3">
                  {[t.building, t.floor].filter(Boolean).join(" ")}{t.user_info ? ` · ${t.user_info}` : ""}{t.label ? ` · ${t.label}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 배선반 일괄 등록 툴바 */}
      <div className="flex items-center justify-end gap-2 mb-2">
        <a href="/api/frames/bulk" download
          className="flex items-center gap-1 border border-line px-2.5 py-1.5 rounded text-xs hover:bg-slate-100 text-ink-2 hover:text-ink">
          <Download size={12} /> 프레임 양식
        </a>
        <button onClick={() => bulkUploadRef.current?.click()} disabled={bulkUploading}
          className="flex items-center gap-1 border border-line px-2.5 py-1.5 rounded text-xs hover:bg-slate-100 text-ink-2 hover:text-ink disabled:opacity-50">
          <Upload size={12} /> {bulkUploading ? "등록중..." : "프레임 일괄 등록"}
        </button>
        <input ref={bulkUploadRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFramesBulk(f); }} />
      </div>

      {/* 상단 통계 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <div className="panel p-4 text-center">
          <div className="text-2xl font-bold num text-ink">{stats.totalFrames}</div>
          <div className="text-xs text-ink-3">전체 배선반</div>
        </div>
        <div className="panel p-4 text-center">
          <div className="text-2xl font-bold num text-ink">{stats.totalPairs}</div>
          <div className="text-xs text-ink-3">전체 페어</div>
        </div>
        <div className="panel p-4 text-center">
          <div className="text-2xl font-bold num text-signal">{stats.used}</div>
          <div className="text-xs text-ink-3 flex items-center justify-center gap-1"><span className="led led-up" />사용중</div>
        </div>
        <div className="panel p-4 text-center">
          <div className="text-2xl font-bold num text-idle">{stats.unused}</div>
          <div className="text-xs text-ink-3 flex items-center justify-center gap-1"><span className="led led-idle" />미사용</div>
        </div>
        <div className="panel p-4 text-center">
          <div className="text-2xl font-bold num text-warn">{stats.reserved}</div>
          <div className="text-xs text-ink-3 flex items-center justify-center gap-1"><span className="led led-warn" />예약</div>
        </div>
        <div className="panel p-4 text-center">
          <div className="text-2xl font-bold num text-fault">{stats.faulty}</div>
          <div className="text-xs text-ink-3 flex items-center justify-center gap-1"><span className="led led-fault" />장애</div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* 좌측 트리 네비게이션 */}
        <div className="w-[250px] shrink-0">
          <div className="panel p-4">
            <div className="flex items-center gap-2 mb-3">
              <GitBranch className="w-4 h-4 text-ink-3" />
              <h3 className="font-semibold text-sm text-ink">건물 / 층</h3>
            </div>

            {/* 검색 */}
            <div className="relative mb-3">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
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
                  !selectedBuilding ? "bg-ink text-white font-medium" : "text-ink-2 hover:text-ink hover:bg-slate-100"
                }`}
              >
                전체 (<span className="num">{frames.length}</span>)
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
                        ? "bg-ink text-white"
                        : "text-ink-2 hover:text-ink hover:bg-slate-100"
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
                          ? "bg-ink text-white font-medium"
                          : "text-ink-2 hover:text-ink hover:bg-slate-100"
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
                  className={`panel p-5 text-left hover-card ${
                    selectedFrame === f.id ? "ring-2 ring-ink border-line-strong" : ""
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="font-semibold text-sm text-ink">{f.frame_name}
                      {f.owner_team_name && <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">{f.owner_team_name}</span>}
                    </div>

                    <span className="eyebrow text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-ink">
                      {frameTypeLabels[f.frame_type] || f.frame_type}
                    </span>
                  </div>
                  <div className="text-xs text-ink-3 mb-3">
                    {[f.building, f.floor, f.room].filter(Boolean).join(" · ") || f.location_name || "위치 미지정"}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-signal rounded-full transition-all"
                        style={{ width: `${usage.pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-ink-3 whitespace-nowrap num">
                      {usage.used}/{usage.total} ({usage.pct}%)
                    </span>
                  </div>
                </button>
              );
            })}
            {filteredFrames.length === 0 && (
              <div className="col-span-full text-center text-ink-3 py-12">
                해당 위치에 배선반이 없습니다.
              </div>
            )}
          </div>

          {/* 110블록 페어 그리드 */}
          {currentFrame && (
            <div className="panel p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-ink">
                  {currentFrame.frame_name} — 페어 그리드
                  <span className="text-xs font-normal text-ink-3 ml-2 num">
                    ({currentFrame.total_pairs}페어)
                  </span>
                </h3>
                <div className="flex items-center gap-3 text-xs text-ink-2">
                  {Object.entries(pairStatusColors).map(([status, cls]) => (
                    <span key={status} className="flex items-center gap-1">
                      <span className={`w-3 h-3 rounded ${cls.split(" ")[0]}`} />
                      {pairStatusLabels[status]}
                    </span>
                  ))}
                  <span className="flex items-center gap-1"><Link2 size={12} /> 대향연결</span>
                  <a href={`/api/frames/${currentFrame.id}/ledger`} download
                    className="flex items-center gap-1 border border-line px-2 py-1 rounded hover:bg-slate-100 text-ink-2 hover:text-ink">
                    <Download size={12} /> 선번장
                  </a>
                  <button onClick={() => uploadRef.current?.click()} disabled={uploading}
                    className="flex items-center gap-1 border border-line px-2 py-1 rounded hover:bg-slate-100 text-ink-2 hover:text-ink disabled:opacity-50">
                    <Upload size={12} /> {uploading ? "반영중..." : "업로드"}
                  </button>
                  <input ref={uploadRef} type="file" accept=".xlsx,.xls" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLedger(f); }} />
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
                      className={`relative w-9 h-9 rounded flex items-center justify-center cursor-pointer hover-cell ${colorCls}`}
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
                      {pair?.linked_pair_id && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-ink border border-white" title="대향 연결됨" />
                      )}

                      {/* 툴팁 */}
                      {hoveredPair?.pair_number === pairNum && pair && (
                        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-ink text-white text-[11px] rounded-lg p-2.5 shadow-lg pointer-events-none">
                          <div className="font-semibold mb-1 num">페어 #{pair.pair_number} <span className="font-normal text-white/60">{colorCodeOf(currentFrame.frame_type, pair.core_number || pair.pair_number)}</span></div>
                          <div>상태: {pairStatusLabels[pair.status]}</div>
                          {pair.core_number != null && <div>코어: <span className="num">{pair.core_number}</span></div>}
                          {pair.linked_frame_name && <div>대향: {pair.linked_frame_name} <span className="num">#{pair.linked_pair_number}</span></div>}
                          {pair.connected_asset_name && <div>장비: {pair.connected_asset_name}</div>}
                          {pair.label && <div>라벨: {pair.label}</div>}
                          {(pair.source || pair.destination) && (
                            <div>{pair.source || "?"} → {pair.destination || "?"}</div>
                          )}
                          {pair.cable_id && <div>케이블: <span className="num">{pair.cable_id}</span></div>}
                          {pair.user_info && <div>사용자: {pair.user_info}</div>}
                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[var(--color-ink)]" />
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
          <div className="bg-panel border border-line rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-ink">
                페어 <span className="num">#{editingPair.pair_number}</span> 편집
                <span className="text-xs font-normal text-ink-3 ml-2">
                  {colorCodeOf(frames.find((f) => f.id === editingPair.frame_id)?.frame_type || "", editingPair.core_number || editingPair.pair_number)}
                </span>
              </h3>
              <button onClick={() => setEditingPair(null)} className="text-ink-2 hover:text-ink hover:bg-slate-100 rounded p-0.5">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">상태</label>
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
                <label className="block text-xs font-medium text-ink-2 mb-1">라벨</label>
                <input
                  className="form-input w-full"
                  value={editingPair.label}
                  onChange={(e) => setEditingPair({ ...editingPair, label: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">코어/회선번호</label>
                  <input
                    type="number"
                    className="form-input w-full"
                    value={editingPair.core_number ?? ""}
                    onChange={(e) => setEditingPair({ ...editingPair, core_number: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">케이블 ID</label>
                  <input
                    className="form-input w-full"
                    value={editingPair.cable_id}
                    onChange={(e) => setEditingPair({ ...editingPair, cable_id: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">소스</label>
                  <input
                    className="form-input w-full"
                    value={editingPair.source}
                    onChange={(e) => setEditingPair({ ...editingPair, source: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-2 mb-1">목적지</label>
                  <input
                    className="form-input w-full"
                    value={editingPair.destination}
                    onChange={(e) => setEditingPair({ ...editingPair, destination: e.target.value })}
                  />
                </div>
              </div>
              {/* 대향 연결 (양단 대사) — 저장 없이 즉시 반영되는 별도 동작 */}
              <div className="border border-line rounded-lg p-3">
                <div className="text-xs font-medium text-ink-2 mb-2 flex items-center gap-1"><Link2 size={12} /> 대향 연결</div>
                {editingPair.linked_pair_id ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{editingPair.linked_frame_name} <span className="num">#{editingPair.linked_pair_number}</span></span>
                    <button onClick={() => jumpToPair(editingPair.linked_frame_id)}
                      className="text-xs text-signal hover:underline flex items-center gap-0.5">이동 <ArrowRight size={10} /></button>
                    <button onClick={() => unlinkPair(editingPair)} disabled={linking}
                      className="ml-auto text-xs text-fault hover:underline flex items-center gap-0.5 disabled:opacity-50">
                      <Unlink size={10} /> 해제
                    </button>
                  </div>
                ) : editingPair.id ? (
                  <div className="flex items-center gap-2">
                    <select value={linkFrameId} onChange={(e) => setLinkFrameId(e.target.value ? Number(e.target.value) : "")}
                      className="form-input text-xs flex-1">
                      <option value="">대향 배선반...</option>
                      {frames
                        .filter((f) => f.id !== editingPair.frame_id && f.frame_type === (frames.find((x) => x.id === editingPair.frame_id)?.frame_type))
                        .map((f) => <option key={f.id} value={f.id}>{f.frame_name}</option>)}
                    </select>
                    <input type="number" placeholder="포트#" value={linkPairNo}
                      onChange={(e) => setLinkPairNo(e.target.value)} className="form-input text-xs w-20" />
                    <button onClick={() => linkPair(editingPair)} disabled={linking}
                      className="btn-ink px-3 py-1.5 text-xs disabled:opacity-50">연결</button>
                  </div>
                ) : (
                  <p className="text-xs text-ink-3">먼저 저장한 뒤 연결할 수 있습니다.</p>
                )}
                <p className="text-[10px] text-ink-3 mt-1.5">같은 유형(광↔광, 110↔110) 배선반끼리만 연결됩니다. 연결·해제는 반대쪽 선번장에 자동 반영됩니다.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-2 mb-1">사용자 정보</label>
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
                className="px-4 py-2 text-sm text-ink-2 border border-line rounded-lg hover:text-ink hover:bg-slate-100"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-ink flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg disabled:opacity-50"
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

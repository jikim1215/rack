"use client";

import { useState } from "react";
import { Plus, MapPin, HardDrive, Pencil, Trash2, X, Save, History, AlertTriangle } from "lucide-react";
import { AuditLogModal, fetchAuditLogs } from "@/components/AuditLogModal";
import { useToast } from "@/components/Toast";

interface Location {
  id: number;
  location_name: string;

  building: string;
  floor: string;
  room: string;
  rack_count: number;
  asset_count: number;
}

interface Rack {
  id: number;
  location_id: number;
  rack_name: string;

  total_units: number;
  description: string;
  location_name: string;
  asset_count: number;
  used_units: number;
}

export function LocationManager({ locations: initLocs, racks: initRacks }: { locations: Location[]; racks: Rack[] }) {
  const { addToast } = useToast();
  const [locations, setLocations] = useState(initLocs);
  const [racks, setRacks] = useState(initRacks);
  const [showLocForm, setShowLocForm] = useState(false);
  const [showRackForm, setShowRackForm] = useState(false);
  const [locForm, setLocForm] = useState({ location_name: "", building: "", floor: "", room: "" });
  const [rackForm, setRackForm] = useState({ location_id: 0, rack_name: "", total_units: 42, description: "" });

  const [editLocId, setEditLocId] = useState<number | null>(null);
  const [editRackId, setEditRackId] = useState<number | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[] | null>(null);
  const [auditRackName, setAuditRackName] = useState("");
  const [selectedLocId, setSelectedLocId] = useState<number | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const displayedRacks = selectedLocId
    ? racks.filter((r) => r.location_id === selectedLocId)
    : racks;

  async function saveLoc() {
    const url = editLocId ? `/api/locations/${editLocId}` : "/api/locations";
    const method = editLocId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(locForm) });
    if (res.ok) {
      const data = await res.json();
      if (editLocId) {
        setLocations((prev) => prev.map((l) => (l.id === editLocId ? { ...l, ...data } : l)));
      } else {
        setLocations((prev) => [...prev, data]);
      }
      setShowLocForm(false);
      setEditLocId(null);
      setLocForm({ location_name: "", building: "", floor: "", room: "" });
      addToast(editLocId ? "위치가 수정되었습니다." : "위치가 추가되었습니다.", "success");
    } else {
      const data = await res.json();
      addToast(data.error || "저장에 실패했습니다.", "error");
    }
  }

  function deleteLoc(id: number) {
    setConfirmDialog({
      message: "위치와 소속 랙이 모두 삭제됩니다. 계속하시겠습니까?",
      onConfirm: async () => {
        setConfirmDialog(null);
        const res = await fetch(`/api/locations/${id}`, { method: "DELETE" });
        if (res.ok) {
          setLocations((prev) => prev.filter((l) => l.id !== id));
          setRacks((prev) => prev.filter((r) => r.location_id !== id));
          addToast("위치가 삭제되었습니다.", "success");
        } else {
          const data = await res.json();
          addToast(data.error || "삭제에 실패했습니다.", "error");
        }
      },
    });
  }

  async function saveRack() {
    const url = editRackId ? `/api/racks/${editRackId}` : "/api/racks";
    const method = editRackId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(rackForm) });
    if (res.ok) {
      const data = await res.json();
      if (editRackId) {
        setRacks((prev) => prev.map((r) => (r.id === editRackId ? { ...r, ...data } : r)));
      } else {
        setRacks((prev) => [...prev, data]);
        // location의 rack_count 즉시 반영
        setLocations((prev) => prev.map((l) =>
          l.id === rackForm.location_id ? { ...l, rack_count: l.rack_count + 1 } : l
        ));
      }
      setShowRackForm(false);
      setEditRackId(null);
      setRackForm({ location_id: 0, rack_name: "", total_units: 42, description: "" });
      addToast(editRackId ? "랙이 수정되었습니다." : "랙이 추가되었습니다.", "success");
    } else {
      const data = await res.json();
      addToast(data.error || "저장에 실패했습니다.", "error");
    }
  }

  function deleteRack(id: number) {
    setConfirmDialog({
      message: "랙을 삭제하시겠습니까? 소속 자산의 랙 정보가 해제됩니다.",
      onConfirm: async () => {
        setConfirmDialog(null);
        const res = await fetch(`/api/racks/${id}`, { method: "DELETE" });
        if (res.ok) {
          const data = await res.json();
          const msg = data.releasedAssets > 0
            ? `랙이 삭제되었습니다. 소속 자산 ${data.releasedAssets}건의 랙 정보가 해제되었습니다.`
            : "랙이 삭제되었습니다.";
          addToast(msg, "success");
          const deletedRack = racks.find((r) => r.id === id);
          setRacks((prev) => prev.filter((r) => r.id !== id));
          if (deletedRack) {
            setLocations((prev) => prev.map((l) =>
              l.id === deletedRack.location_id ? { ...l, rack_count: Math.max(0, l.rack_count - 1) } : l
            ));
          }
        } else {
          const data = await res.json().catch(() => ({}));
          addToast(data.error || "삭제에 실패했습니다.", "error");
        }
      },
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 위치 */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg flex items-center gap-2"><MapPin size={18} /> 위치 목록 <span className="text-xs font-normal text-ink-3 ml-1">— 클릭하면 우측 랙이 필터됩니다</span></h3>
          <button onClick={() => { setShowLocForm(true); setEditLocId(null); setLocForm({ location_name: "", building: "", floor: "", room: "" }); }}

            className="btn-ink flex items-center gap-1 px-3 py-1.5 text-sm">
            <Plus size={14} /> 추가
          </button>
        </div>

        {showLocForm && (
          <div className="panel p-4 mb-3">
            <div className="flex justify-between mb-3">
              <h4 className="font-medium text-sm">{editLocId ? "위치 수정" : "위치 추가"}</h4>
              <button onClick={() => setShowLocForm(false)} className="text-ink-2 hover:text-ink hover:bg-slate-100 rounded p-1"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block col-span-2"><span className="text-xs text-slate-500">이름</span>
                <input value={locForm.location_name} onChange={(e) => setLocForm({ ...locForm, location_name: e.target.value })} className="form-input" /></label>

              <label className="block"><span className="text-xs text-slate-500">건물</span>
                <input value={locForm.building} onChange={(e) => setLocForm({ ...locForm, building: e.target.value })} className="form-input" /></label>
              <label className="block"><span className="text-xs text-slate-500">층</span>
                <input value={locForm.floor} onChange={(e) => setLocForm({ ...locForm, floor: e.target.value })} className="form-input" /></label>
              <label className="block col-span-2"><span className="text-xs text-slate-500">실</span>
                <input value={locForm.room} onChange={(e) => setLocForm({ ...locForm, room: e.target.value })} className="form-input" /></label>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={saveLoc} className="btn-ink flex items-center gap-1 px-3 py-1.5 text-sm"><Save size={14} /> 저장</button>
              <button onClick={() => setShowLocForm(false)} className="px-3 py-1.5 border border-line rounded text-sm text-ink-2 hover:text-ink hover:bg-slate-100">취소</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {locations.map((loc) => (
            <div key={loc.id}
              onClick={() => setSelectedLocId(selectedLocId === loc.id ? null : loc.id)}
              className={`panel p-4 flex items-center justify-between cursor-pointer transition-colors ${selectedLocId === loc.id ? "ring-1 ring-signal" : ""}`}>
              <div>
                <div className="font-medium">{loc.location_name}</div>
                <div className="text-xs text-ink-3">{loc.building} {loc.floor} {loc.room}</div>
                <div className="text-xs text-ink-2 mt-1">랙 <span className="num">{loc.rack_count}</span>개 · 자산 <span className="num">{loc.asset_count}</span>대</div>
              </div>
              <div className="flex gap-1 text-xs" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { setEditLocId(loc.id); setLocForm({ location_name: loc.location_name, building: loc.building, floor: loc.floor, room: loc.room }); setShowLocForm(true); }}
                  className="flex items-center gap-1 px-2 py-1 text-ink-2 hover:text-ink hover:bg-surface rounded"><Pencil size={12} /> 수정</button>
                <button onClick={() => deleteLoc(loc.id)}
                  className="flex items-center gap-1 px-2 py-1 text-fault hover:bg-red-50/10 rounded"><Trash2 size={12} /> 삭제</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 랙 */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <HardDrive size={18} />
            {selectedLocId ? `${locations.find(l => l.id === selectedLocId)?.location_name} 랙` : "전체 랙 목록"}
            {selectedLocId && <button onClick={() => setSelectedLocId(null)} className="text-xs text-ink-3 hover:text-ink ml-1">(전체 보기)</button>}
          </h3>
          <button onClick={() => { setShowRackForm(true); setEditRackId(null); setRackForm({ location_id: locations[0]?.id ?? 0, rack_name: "", total_units: 42, description: "" }); }}

            className="btn-ink flex items-center gap-1 px-3 py-1.5 text-sm">
            <Plus size={14} /> 추가
          </button>
        </div>

        {showRackForm && (
          <div className="panel p-4 mb-3">
            <div className="flex justify-between mb-3">
              <h4 className="font-medium text-sm">{editRackId ? "랙 수정" : "랙 추가"}</h4>
              <button onClick={() => setShowRackForm(false)} className="text-ink-2 hover:text-ink hover:bg-slate-100 rounded p-1"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="text-xs text-slate-500">위치</span>
                <select value={rackForm.location_id} onChange={(e) => setRackForm({ ...rackForm, location_id: Number(e.target.value) })} className="form-input">
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.location_name}</option>)}

                </select></label>
              <label className="block"><span className="text-xs text-slate-500">이름</span>
                <input value={rackForm.rack_name} onChange={(e) => setRackForm({ ...rackForm, rack_name: e.target.value })} className="form-input" /></label>

              <label className="block"><span className="text-xs text-slate-500">총 유닛 수</span>
                <select value={rackForm.total_units} onChange={(e) => setRackForm({ ...rackForm, total_units: Number(e.target.value) })} className="form-input">
                  <option value={4}>4U (소형)</option>
                  <option value={9}>9U</option>
                  <option value={12}>12U</option>
                  <option value={15}>15U</option>
                  <option value={18}>18U</option>
                  <option value={22}>22U</option>
                  <option value={24}>24U (하프랙)</option>
                  <option value={27}>27U</option>
                  <option value={32}>32U</option>
                  <option value={37}>37U</option>
                  <option value={42}>42U (표준랙)</option>
                  <option value={45}>45U</option>
                  <option value={47}>47U</option>
                  <option value={48}>48U</option>
                </select></label>
              <label className="block"><span className="text-xs text-slate-500">설명</span>
                <input value={rackForm.description} onChange={(e) => setRackForm({ ...rackForm, description: e.target.value })} className="form-input" /></label>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={saveRack} className="btn-ink flex items-center gap-1 px-3 py-1.5 text-sm"><Save size={14} /> 저장</button>
              <button onClick={() => setShowRackForm(false)} className="px-3 py-1.5 border border-line rounded text-sm text-ink-2 hover:text-ink hover:bg-slate-100">취소</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {displayedRacks.map((rack) => {
            const pct = rack.total_units > 0 ? Math.round((rack.used_units / rack.total_units) * 100) : 0;
            return (
              <div key={rack.id} className="panel p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{rack.rack_name}</div>

                    <div className="text-xs text-ink-3">{rack.location_name}</div>
                    <div className="text-xs text-ink-2 mt-1">
                      <span className="num">{rack.used_units}</span>U / <span className="num">{rack.total_units}</span>U (<span className="num">{pct}</span>%) · <span className="num">{rack.asset_count}</span>대
                    </div>
                  </div>
                  <div className="flex gap-1 text-xs">
                    <button onClick={() => { setEditRackId(rack.id); setRackForm({ location_id: rack.location_id, rack_name: rack.rack_name, total_units: rack.total_units, description: rack.description }); setShowRackForm(true); }}
                      className="flex items-center gap-1 px-2 py-1 text-ink-2 hover:text-ink hover:bg-surface rounded"><Pencil size={12} /> 수정</button>
                    <button onClick={async () => {
                      const logs = await fetchAuditLogs("rack", rack.id);
                      if (logs) { setAuditLogs(logs); setAuditRackName(rack.rack_name); }
                    }} className="flex items-center gap-1 px-2 py-1 text-ink-2 hover:text-ink hover:bg-surface rounded"><History size={12} /> 이력</button>
                    <button onClick={() => deleteRack(rack.id)}
                      className="flex items-center gap-1 px-2 py-1 text-fault hover:bg-red-50/10 rounded"><Trash2 size={12} /> 삭제</button>
                  </div>
                </div>
                <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${pct > 80 ? "bg-fault" : pct > 50 ? "bg-warn" : "bg-signal"}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 랙 이력 모달 (공통 컴포넌트) */}
      {auditLogs !== null && (
        <AuditLogModal logs={auditLogs} title={auditRackName} onClose={() => setAuditLogs(null)} />
      )}

      {/* 커스텀 확인 모달 */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={() => setConfirmDialog(null)}>
          <div className="bg-panel border border-line rounded-xl shadow-xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={20} className="text-warning shrink-0" />
              <h3 className="font-semibold">확인</h3>
            </div>
            <p className="text-sm text-ink-2 mb-5">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 border border-line rounded text-sm text-ink-2 hover:text-ink hover:bg-surface">취소</button>
              <button onClick={confirmDialog.onConfirm}
                className="px-4 py-2 bg-fault text-white rounded text-sm hover:bg-red-700">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

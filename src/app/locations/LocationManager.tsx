"use client";

import { useState } from "react";
import { Plus, MapPin, HardDrive, Pencil, Trash2, X, Save } from "lucide-react";

interface Location {
  id: number;
  name: string;
  building: string;
  floor: string;
  room: string;
  rack_count: number;
  asset_count: number;
}

interface Rack {
  id: number;
  location_id: number;
  name: string;
  total_units: number;
  description: string;
  location_name: string;
  asset_count: number;
  used_units: number;
}

export function LocationManager({ locations: initLocs, racks: initRacks }: { locations: Location[]; racks: Rack[] }) {
  const [locations, setLocations] = useState(initLocs);
  const [racks, setRacks] = useState(initRacks);
  const [showLocForm, setShowLocForm] = useState(false);
  const [showRackForm, setShowRackForm] = useState(false);
  const [locForm, setLocForm] = useState({ name: "", building: "", floor: "", room: "" });
  const [rackForm, setRackForm] = useState({ location_id: 0, name: "", total_units: 42, description: "" });
  const [editLocId, setEditLocId] = useState<number | null>(null);
  const [editRackId, setEditRackId] = useState<number | null>(null);

  async function saveLoc() {
    const url = editLocId ? `/api/locations/${editLocId}` : "/api/locations";
    const method = editLocId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(locForm) });
    if (res.ok) {
      const data = await res.json();
      if (editLocId) {
        setLocations((prev) => prev.map((l) => (l.id === editLocId ? { ...l, ...data } : l)));
      } else {
        setLocations((prev) => [...prev, { ...data, rack_count: 0, asset_count: 0 }]);
      }
      setShowLocForm(false);
      setEditLocId(null);
      setLocForm({ name: "", building: "", floor: "", room: "" });
    }
  }

  async function deleteLoc(id: number) {
    if (!confirm("위치와 소속 랙이 모두 삭제됩니다. 계속하시겠습니까?")) return;
    const res = await fetch(`/api/locations/${id}`, { method: "DELETE" });
    if (res.ok) {
      setLocations((prev) => prev.filter((l) => l.id !== id));
      setRacks((prev) => prev.filter((r) => r.location_id !== id));
    }
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
        setRacks((prev) => [...prev, { ...data, asset_count: 0, used_units: 0 }]);
      }
      setShowRackForm(false);
      setEditRackId(null);
      setRackForm({ location_id: 0, name: "", total_units: 42, description: "" });
    }
  }

  async function deleteRack(id: number) {
    if (!confirm("랙을 삭제하시겠습니까? 소속 자산의 랙 정보가 해제됩니다.")) return;
    const res = await fetch(`/api/racks/${id}`, { method: "DELETE" });
    if (res.ok) {
      setRacks((prev) => prev.filter((r) => r.id !== id));
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 위치 */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg flex items-center gap-2"><MapPin size={18} /> 위치 목록</h3>
          <button onClick={() => { setShowLocForm(true); setEditLocId(null); setLocForm({ name: "", building: "", floor: "", room: "" }); }}
            className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">
            <Plus size={14} /> 추가
          </button>
        </div>

        {showLocForm && (
          <div className="bg-white border rounded-lg p-4 mb-3">
            <div className="flex justify-between mb-3">
              <h4 className="font-medium text-sm">{editLocId ? "위치 수정" : "위치 추가"}</h4>
              <button onClick={() => setShowLocForm(false)} className="text-slate-400"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block col-span-2"><span className="text-xs text-slate-500">이름</span>
                <input value={locForm.name} onChange={(e) => setLocForm({ ...locForm, name: e.target.value })} className="form-input" /></label>
              <label className="block"><span className="text-xs text-slate-500">건물</span>
                <input value={locForm.building} onChange={(e) => setLocForm({ ...locForm, building: e.target.value })} className="form-input" /></label>
              <label className="block"><span className="text-xs text-slate-500">층</span>
                <input value={locForm.floor} onChange={(e) => setLocForm({ ...locForm, floor: e.target.value })} className="form-input" /></label>
              <label className="block col-span-2"><span className="text-xs text-slate-500">실</span>
                <input value={locForm.room} onChange={(e) => setLocForm({ ...locForm, room: e.target.value })} className="form-input" /></label>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={saveLoc} className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-sm"><Save size={14} /> 저장</button>
              <button onClick={() => setShowLocForm(false)} className="px-3 py-1.5 border rounded text-sm">취소</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {locations.map((loc) => (
            <div key={loc.id} className="bg-white border rounded-lg p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{loc.name}</div>
                <div className="text-xs text-slate-400">{loc.building} {loc.floor} {loc.room}</div>
                <div className="text-xs text-slate-500 mt-1">랙 {loc.rack_count}개 · 자산 {loc.asset_count}대</div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => { setEditLocId(loc.id); setLocForm({ name: loc.name, building: loc.building, floor: loc.floor, room: loc.room }); setShowLocForm(true); }}
                  className="p-1.5 text-slate-400 hover:text-blue-600 rounded"><Pencil size={14} /></button>
                <button onClick={() => deleteLoc(loc.id)}
                  className="p-1.5 text-slate-400 hover:text-red-600 rounded"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 랙 */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg flex items-center gap-2"><HardDrive size={18} /> 랙 목록</h3>
          <button onClick={() => { setShowRackForm(true); setEditRackId(null); setRackForm({ location_id: locations[0]?.id ?? 0, name: "", total_units: 42, description: "" }); }}
            className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">
            <Plus size={14} /> 추가
          </button>
        </div>

        {showRackForm && (
          <div className="bg-white border rounded-lg p-4 mb-3">
            <div className="flex justify-between mb-3">
              <h4 className="font-medium text-sm">{editRackId ? "랙 수정" : "랙 추가"}</h4>
              <button onClick={() => setShowRackForm(false)} className="text-slate-400"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="text-xs text-slate-500">위치</span>
                <select value={rackForm.location_id} onChange={(e) => setRackForm({ ...rackForm, location_id: Number(e.target.value) })} className="form-input">
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select></label>
              <label className="block"><span className="text-xs text-slate-500">이름</span>
                <input value={rackForm.name} onChange={(e) => setRackForm({ ...rackForm, name: e.target.value })} className="form-input" /></label>
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
              <button onClick={saveRack} className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-sm"><Save size={14} /> 저장</button>
              <button onClick={() => setShowRackForm(false)} className="px-3 py-1.5 border rounded text-sm">취소</button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {racks.map((rack) => {
            const pct = rack.total_units > 0 ? Math.round((rack.used_units / rack.total_units) * 100) : 0;
            return (
              <div key={rack.id} className="bg-white border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{rack.name}</div>
                    <div className="text-xs text-slate-400">{rack.location_name}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {rack.used_units}U / {rack.total_units}U ({pct}%) · {rack.asset_count}대
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setEditRackId(rack.id); setRackForm({ location_id: rack.location_id, name: rack.name, total_units: rack.total_units, description: rack.description }); setShowRackForm(true); }}
                      className="p-1.5 text-slate-400 hover:text-blue-600 rounded"><Pencil size={14} /></button>
                    <button onClick={() => deleteRack(rack.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

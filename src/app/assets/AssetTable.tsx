"use client";

import { useState } from "react";
import { Plus, Search, Pencil, Trash2, X, Save } from "lucide-react";

const typeLabels: Record<string, string> = {
  server: "서버", network: "네트워크", security: "정보보호", storage: "스토리지", other: "기타",
};
const typeColors: Record<string, string> = {
  server: "bg-blue-100 text-blue-700",
  network: "bg-green-100 text-green-700",
  security: "bg-red-100 text-red-700",
  storage: "bg-purple-100 text-purple-700",
  other: "bg-gray-100 text-gray-700",
};
const statusLabels: Record<string, string> = {
  active: "운용중", inactive: "미사용", maintenance: "점검중", decommissioned: "폐기",
};

interface Asset {
  id: number;
  asset_type: string;
  name: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  ip_address: string;
  asset_tag: string;
  status: string;
  rack_id: number | null;
  rack_name: string | null;
  location_name: string | null;
  rack_unit_start: number | null;
  rack_unit_size: number;
  description: string;
}

const emptyAsset = {
  asset_type: "server", name: "", manufacturer: "", model: "",
  serial_number: "", ip_address: "", asset_tag: "", status: "active",
  rack_id: null as number | null, rack_unit_start: null as number | null,
  rack_unit_size: 1, description: "",
};

export function AssetTable({ assets: initialAssets, racks }: { assets: Asset[]; racks: any[] }) {
  const [assets, setAssets] = useState(initialAssets);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyAsset);

  const filtered = assets.filter((a) => {
    if (typeFilter && a.asset_type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        a.name.toLowerCase().includes(q) ||
        a.ip_address.toLowerCase().includes(q) ||
        a.manufacturer.toLowerCase().includes(q) ||
        a.model.toLowerCase().includes(q) ||
        a.serial_number.toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function handleSave() {
    const url = editId ? `/api/assets/${editId}` : "/api/assets";
    const method = editId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      const data = await res.json();
      if (editId) {
        setAssets((prev) => prev.map((a) => (a.id === editId ? { ...a, ...data } : a)));
      } else {
        setAssets((prev) => [data, ...prev]);
      }
      setShowForm(false);
      setEditId(null);
      setForm(emptyAsset);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
    if (res.ok) {
      setAssets((prev) => prev.filter((a) => a.id !== id));
    }
  }

  function startEdit(asset: Asset) {
    setForm({
      asset_type: asset.asset_type,
      name: asset.name,
      manufacturer: asset.manufacturer,
      model: asset.model,
      serial_number: asset.serial_number,
      ip_address: asset.ip_address,
      asset_tag: asset.asset_tag,
      status: asset.status,
      rack_id: asset.rack_id,
      rack_unit_start: asset.rack_unit_start,
      rack_unit_size: asset.rack_unit_size,
      description: asset.description,
    });
    setEditId(asset.id);
    setShowForm(true);
  }

  return (
    <div>
      {/* 필터/검색/추가 바 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="이름, IP, 제조사, 모델 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">전체 유형</option>
          {Object.entries(typeLabels).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button
          onClick={() => { setShowForm(true); setEditId(null); setForm(emptyAsset); }}
          className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} /> 자산 등록
        </button>
      </div>

      {/* 등록/수정 폼 */}
      {showForm && (
        <div className="bg-white border rounded-lg p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">{editId ? "자산 수정" : "자산 등록"}</h3>
            <button onClick={() => { setShowForm(false); setEditId(null); }} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField label="유형">
              <select value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })} className="form-input">
                {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </FormField>
            <FormField label="이름"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="form-input" /></FormField>
            <FormField label="제조사"><input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} className="form-input" /></FormField>
            <FormField label="모델"><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="form-input" /></FormField>
            <FormField label="시리얼"><input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} className="form-input" /></FormField>
            <FormField label="IP 주소"><input value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} className="form-input" /></FormField>
            <FormField label="자산태그"><input value={form.asset_tag} onChange={(e) => setForm({ ...form, asset_tag: e.target.value })} className="form-input" /></FormField>
            <FormField label="상태">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="form-input">
                {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </FormField>
            <FormField label="설치 랙">
              <select value={form.rack_id ?? ""} onChange={(e) => setForm({ ...form, rack_id: e.target.value ? Number(e.target.value) : null })} className="form-input">
                <option value="">미설치</option>
                {racks.map((r: any) => <option key={r.id} value={r.id}>{r.name} ({r.location_name})</option>)}
              </select>
            </FormField>
            <FormField label="시작 U"><input type="number" value={form.rack_unit_start ?? ""} onChange={(e) => setForm({ ...form, rack_unit_start: e.target.value ? Number(e.target.value) : null })} className="form-input" /></FormField>
            <FormField label="크기 (U)"><input type="number" value={form.rack_unit_size} onChange={(e) => setForm({ ...form, rack_unit_size: Number(e.target.value) || 1 })} className="form-input" /></FormField>
            <FormField label="설명"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="form-input" /></FormField>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={handleSave} className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">
              <Save size={16} /> {editId ? "수정" : "등록"}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null); }} className="px-4 py-2 border rounded-lg text-sm hover:bg-slate-50">
              취소
            </button>
          </div>
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b text-left text-slate-600">
                <th className="p-3">유형</th>
                <th className="p-3">이름</th>
                <th className="p-3">제조사/모델</th>
                <th className="p-3">IP</th>
                <th className="p-3">위치</th>
                <th className="p-3">상태</th>
                <th className="p-3 w-20">관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-slate-50">
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${typeColors[a.asset_type]}`}>
                      {typeLabels[a.asset_type]}
                    </span>
                  </td>
                  <td className="p-3 font-medium">{a.name}</td>
                  <td className="p-3 text-slate-500">{a.manufacturer} {a.model}</td>
                  <td className="p-3 font-mono text-xs text-slate-500">{a.ip_address}</td>
                  <td className="p-3 text-xs text-slate-500">
                    {a.rack_name ? `${a.location_name} / ${a.rack_name} (${a.rack_unit_start}U)` : "-"}
                  </td>
                  <td className="p-3">
                    <span className={`text-xs font-medium ${a.status === "active" ? "text-green-600" : a.status === "maintenance" ? "text-amber-600" : "text-slate-400"}`}>
                      {statusLabels[a.status]}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(a)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(a.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-slate-400">등록된 자산이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t p-3 text-xs text-slate-400">
          총 {filtered.length}건
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

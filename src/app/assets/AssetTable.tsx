"use client";

import { useState } from "react";
import { Plus, Search, Pencil, Trash2, X, Save, ChevronDown, ChevronUp, Settings } from "lucide-react";

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
  os: string;
  access_ip: string;
  user_name: string;
  admin_name: string;
  department: string;
  rack_id: number | null;
  rack_name: string | null;
  location_name: string | null;
  rack_unit_start: number | null;
  rack_unit_size: number;
  description: string;
}

interface CustomField {
  id: number;
  field_key: string;
  field_label: string;
  field_type: string;
  options: string;
  asset_types: string;
}

const emptyAsset = {
  asset_type: "server", name: "", manufacturer: "", model: "",
  serial_number: "", ip_address: "", asset_tag: "", status: "active",
  os: "", access_ip: "", user_name: "", admin_name: "", department: "",
  rack_id: null as number | null, rack_unit_start: null as number | null,
  rack_unit_size: 1, description: "",
};

interface Props {
  assets: Asset[];
  racks: any[];
  customFields: CustomField[];
  customValuesMap: Record<number, Record<number, string>>;
}

export function AssetTable({ assets: initialAssets, racks, customFields: initFields, customValuesMap: initCvMap }: Props) {
  const [assets, setAssets] = useState(initialAssets);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyAsset);
  const [customValues, setCustomValues] = useState<Record<number, string>>({});
  const [cvMap, setCvMap] = useState(initCvMap);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // 커스텀 필드 관리
  const [customFields, setCustomFields] = useState(initFields);
  const [showFieldManager, setShowFieldManager] = useState(false);
  const [fieldForm, setFieldForm] = useState({
    field_key: "", field_label: "", field_type: "text", options: "", asset_types: "",
  });
  const [editFieldId, setEditFieldId] = useState<number | null>(null);

  const filtered = assets.filter((a) => {
    if (typeFilter && a.asset_type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        a.name.toLowerCase().includes(q) ||
        a.ip_address.toLowerCase().includes(q) ||
        a.manufacturer.toLowerCase().includes(q) ||
        a.model.toLowerCase().includes(q) ||
        a.serial_number.toLowerCase().includes(q) ||
        a.os.toLowerCase().includes(q) ||
        a.admin_name.toLowerCase().includes(q) ||
        a.user_name.toLowerCase().includes(q) ||
        a.department.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // 해당 asset_type에 적용되는 커스텀 필드
  function getFieldsForType(assetType: string) {
    return customFields.filter((f) => {
      if (!f.asset_types) return true;
      return f.asset_types.split(",").map((s: string) => s.trim()).includes(assetType);
    });
  }

  async function handleSave() {
    const url = editId ? `/api/assets/${editId}` : "/api/assets";
    const method = editId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, custom_values: customValues }),
    });
    if (res.ok) {
      const data = await res.json();
      if (editId) {
        setAssets((prev) => prev.map((a) => (a.id === editId ? { ...a, ...data } : a)));
        setCvMap((prev) => ({ ...prev, [editId]: { ...customValues } }));
      } else {
        setAssets((prev) => [data, ...prev]);
        setCvMap((prev) => ({ ...prev, [data.id]: { ...customValues } }));
      }
      setShowForm(false);
      setEditId(null);
      setForm(emptyAsset);
      setCustomValues({});
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
      os: asset.os,
      access_ip: asset.access_ip,
      user_name: asset.user_name,
      admin_name: asset.admin_name,
      department: asset.department,
      rack_id: asset.rack_id,
      rack_unit_start: asset.rack_unit_start,
      rack_unit_size: asset.rack_unit_size,
      description: asset.description,
    });
    setCustomValues(cvMap[asset.id] || {});
    setEditId(asset.id);
    setShowForm(true);
  }

  async function addCustomField() {
    if (!fieldForm.field_key || !fieldForm.field_label) return;
    const res = await fetch("/api/custom-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fieldForm),
    });
    if (res.ok) {
      const data = await res.json();
      setCustomFields((prev) => [...prev, data]);
      setFieldForm({ field_key: "", field_label: "", field_type: "text", options: "", asset_types: "" });
    }
  }

  async function saveCustomField() {
    if (!editFieldId || !fieldForm.field_label) return;
    const res = await fetch(`/api/custom-fields/${editFieldId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fieldForm),
    });
    if (res.ok) {
      const data = await res.json();
      setCustomFields((prev) => prev.map((f) => (f.id === editFieldId ? { ...f, ...data } : f)));
      setEditFieldId(null);
      setFieldForm({ field_key: "", field_label: "", field_type: "text", options: "", asset_types: "" });
    }
  }

  function startEditField(f: CustomField) {
    setEditFieldId(f.id);
    setFieldForm({
      field_key: f.field_key,
      field_label: f.field_label,
      field_type: f.field_type,
      options: f.options,
      asset_types: f.asset_types,
    });
  }

  function cancelEditField() {
    setEditFieldId(null);
    setFieldForm({ field_key: "", field_label: "", field_type: "text", options: "", asset_types: "" });
  }

  async function deleteCustomField(id: number) {
    if (!confirm("이 커스텀 필드를 비활성화하시겠습니까?")) return;
    const res = await fetch(`/api/custom-fields/${id}`, { method: "DELETE" });
    if (res.ok) {
      setCustomFields((prev) => prev.filter((f) => f.id !== id));
      if (editFieldId === id) cancelEditField();
    }
  }

  return (
    <div>
      {/* 필터/검색/추가 바 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="이름, IP, 제조사, OS, 관리자, 부서 검색..."
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
          onClick={() => { setShowForm(true); setEditId(null); setForm(emptyAsset); setCustomValues({}); }}
          className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} /> 자산 등록
        </button>
        <button
          onClick={() => setShowFieldManager(!showFieldManager)}
          className="flex items-center gap-1.5 border px-3 py-2 rounded-lg text-sm hover:bg-slate-50 transition-colors text-slate-600"
        >
          <Settings size={16} /> 확장필드
        </button>
      </div>

      {/* 커스텀 필드 관리 */}
      {showFieldManager && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 mb-4">
          <h3 className="font-semibold mb-3 text-amber-800">확장 필드 관리</h3>
          <p className="text-xs text-amber-600 mb-3">자산에 추가할 커스텀 속성을 정의합니다. 필드 키는 영문, 라벨은 표시명입니다.</p>

          {/* 기존 필드 목록 */}
          {customFields.length > 0 && (
            <div className="mb-4 space-y-1">
              {customFields.map((f) => (
                editFieldId === f.id ? (
                  <div key={f.id} className="grid grid-cols-2 md:grid-cols-6 gap-2 bg-blue-50 rounded px-3 py-2 items-center">
                    <input value={fieldForm.field_key} disabled
                      className="form-input text-xs bg-slate-100 cursor-not-allowed" title="키는 변경 불가" />
                    <input placeholder="표시 라벨" value={fieldForm.field_label}
                      onChange={(e) => setFieldForm({ ...fieldForm, field_label: e.target.value })} className="form-input text-xs" />
                    <select value={fieldForm.field_type}
                      onChange={(e) => setFieldForm({ ...fieldForm, field_type: e.target.value })} className="form-input text-xs">
                      <option value="text">텍스트</option>
                      <option value="number">숫자</option>
                      <option value="date">날짜</option>
                      <option value="select">선택</option>
                      <option value="textarea">텍스트영역</option>
                    </select>
                    <input placeholder="옵션 (콤마구분)" value={fieldForm.options}
                      onChange={(e) => setFieldForm({ ...fieldForm, options: e.target.value })} className="form-input text-xs" />
                    <input placeholder="적용 유형 (빈칸=전체)" value={fieldForm.asset_types}
                      onChange={(e) => setFieldForm({ ...fieldForm, asset_types: e.target.value })} className="form-input text-xs" />
                    <div className="flex gap-1">
                      <button onClick={saveCustomField} className="flex-1 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 py-1.5">저장</button>
                      <button onClick={cancelEditField} className="flex-1 border rounded-lg text-xs hover:bg-white py-1.5">취소</button>
                    </div>
                  </div>
                ) : (
                  <div key={f.id} className="flex items-center justify-between bg-white rounded px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium">{f.field_label}</span>
                      <span className="text-slate-400 ml-2">({f.field_key})</span>
                      <span className="text-xs ml-2 px-1.5 py-0.5 bg-slate-100 rounded">{f.field_type}</span>
                      {f.asset_types && <span className="text-xs ml-2 text-blue-600">{f.asset_types}</span>}
                      {f.options && <span className="text-xs ml-2 text-green-600">옵션: {f.options}</span>}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => startEditField(f)} className="text-slate-400 hover:text-blue-600">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => deleteCustomField(f.id)} className="text-slate-400 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              ))}
            </div>
          )}

          {/* 새 필드 추가 */}
          {!editFieldId && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <input placeholder="필드 키 (영문)" value={fieldForm.field_key}
              onChange={(e) => setFieldForm({ ...fieldForm, field_key: e.target.value })} className="form-input text-xs" />
            <input placeholder="표시 라벨" value={fieldForm.field_label}
              onChange={(e) => setFieldForm({ ...fieldForm, field_label: e.target.value })} className="form-input text-xs" />
            <select value={fieldForm.field_type}
              onChange={(e) => setFieldForm({ ...fieldForm, field_type: e.target.value })} className="form-input text-xs">
              <option value="text">텍스트</option>
              <option value="number">숫자</option>
              <option value="date">날짜</option>
              <option value="select">선택</option>
              <option value="textarea">텍스트영역</option>
            </select>
            <input placeholder="옵션 (콤마구분)" value={fieldForm.options}
              onChange={(e) => setFieldForm({ ...fieldForm, options: e.target.value })} className="form-input text-xs" />
            <input placeholder="적용 유형 (빈칸=전체)" value={fieldForm.asset_types}
              onChange={(e) => setFieldForm({ ...fieldForm, asset_types: e.target.value })} className="form-input text-xs" />
            <button onClick={addCustomField} className="bg-amber-600 text-white rounded-lg text-xs hover:bg-amber-700">추가</button>
          </div>
          )}
        </div>
      )}

      {/* 등록/수정 폼 */}
      {showForm && (
        <div className="bg-white border rounded-lg p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">{editId ? "자산 수정" : "자산 등록"}</h3>
            <button onClick={() => { setShowForm(false); setEditId(null); }} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>

          {/* 기본 정보 */}
          <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">기본 정보</h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <FormField label="유형">
              <select value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })} className="form-input">
                {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </FormField>
            <FormField label="이름 *"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="form-input" /></FormField>
            <FormField label="제조사"><input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} className="form-input" /></FormField>
            <FormField label="모델"><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="form-input" /></FormField>
            <FormField label="시리얼"><input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} className="form-input" /></FormField>
            <FormField label="IP 주소"><input value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} className="form-input" placeholder="관리 IP" /></FormField>
            <FormField label="자산태그"><input value={form.asset_tag} onChange={(e) => setForm({ ...form, asset_tag: e.target.value })} className="form-input" /></FormField>
            <FormField label="상태">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="form-input">
                {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </FormField>
          </div>

          {/* 운영 정보 */}
          <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">운영 정보</h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <FormField label="OS / 펌웨어"><input value={form.os} onChange={(e) => setForm({ ...form, os: e.target.value })} className="form-input" placeholder="예: Rocky Linux 8.9" /></FormField>
            <FormField label="접근 IP"><input value={form.access_ip} onChange={(e) => setForm({ ...form, access_ip: e.target.value })} className="form-input" placeholder="서비스/접근용 IP" /></FormField>
            <FormField label="사용자"><input value={form.user_name} onChange={(e) => setForm({ ...form, user_name: e.target.value })} className="form-input" /></FormField>
            <FormField label="관리자"><input value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} className="form-input" /></FormField>
            <FormField label="부서"><input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="form-input" /></FormField>
            <FormField label="설명"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="form-input" /></FormField>
          </div>

          {/* 랙 배치 */}
          <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">랙 배치</h4>
          {(() => {
            const selectedRack = racks.find((r: any) => r.id === form.rack_id);
            const maxU = selectedRack?.total_units ?? 42;
            const maxStart = Math.max(1, maxU - (form.rack_unit_size ?? 1) + 1);
            const maxSize = form.rack_unit_start ? Math.max(1, maxU - form.rack_unit_start + 1) : maxU;
            return (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <FormField label="설치 랙">
              <select value={form.rack_id ?? ""} onChange={(e) => {
                const newRackId = e.target.value ? Number(e.target.value) : null;
                setForm({ ...form, rack_id: newRackId, rack_unit_start: null, rack_unit_size: 1 });
              }} className="form-input">
                <option value="">미설치</option>
                {racks.map((r: any) => <option key={r.id} value={r.id}>{r.name} ({r.location_name}) — {r.total_units}U</option>)}
              </select>
            </FormField>
            <FormField label={`시작 U${selectedRack ? ` (1~${maxStart})` : ""}`}>
              <input type="number" min={1} max={maxStart}
                value={form.rack_unit_start ?? ""}
                onChange={(e) => {
                  const v = e.target.value ? Math.min(Math.max(1, Number(e.target.value)), maxStart) : null;
                  setForm({ ...form, rack_unit_start: v });
                }}
                disabled={!form.rack_id}
                className="form-input" placeholder={form.rack_id ? `1~${maxStart}` : "랙 선택 필요"} />
            </FormField>
            <FormField label={`크기 U${selectedRack ? ` (1~${maxSize})` : ""}`}>
              <input type="number" min={1} max={maxSize}
                value={form.rack_unit_size}
                onChange={(e) => {
                  const v = Math.min(Math.max(1, Number(e.target.value) || 1), maxSize);
                  setForm({ ...form, rack_unit_size: v });
                }}
                disabled={!form.rack_id}
                className="form-input" placeholder={form.rack_id ? `1~${maxSize}` : "랙 선택 필요"} />
            </FormField>
            {selectedRack && (
              <div className="flex items-end pb-1">
                <span className="text-xs text-slate-400">
                  {form.rack_unit_start && form.rack_unit_size
                    ? `${form.rack_unit_start}U ~ ${form.rack_unit_start + form.rack_unit_size - 1}U 사용`
                    : "배치 위치를 지정하세요"}
                </span>
              </div>
            )}
          </div>
            );
          })()}

          {/* 커스텀 필드 */}
          {getFieldsForType(form.asset_type).length > 0 && (
            <>
              <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">확장 필드</h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                {getFieldsForType(form.asset_type).map((f) => (
                  <FormField key={f.id} label={f.field_label}>
                    {f.field_type === "select" ? (
                      <select
                        value={customValues[f.id] || ""}
                        onChange={(e) => setCustomValues({ ...customValues, [f.id]: e.target.value })}
                        className="form-input"
                      >
                        <option value="">선택</option>
                        {f.options.split(",").map((opt: string) => (
                          <option key={opt.trim()} value={opt.trim()}>{opt.trim()}</option>
                        ))}
                      </select>
                    ) : f.field_type === "textarea" ? (
                      <textarea
                        value={customValues[f.id] || ""}
                        onChange={(e) => setCustomValues({ ...customValues, [f.id]: e.target.value })}
                        className="form-input"
                        rows={2}
                      />
                    ) : (
                      <input
                        type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
                        value={customValues[f.id] || ""}
                        onChange={(e) => setCustomValues({ ...customValues, [f.id]: e.target.value })}
                        className="form-input"
                      />
                    )}
                  </FormField>
                ))}
              </div>
            </>
          )}

          <div className="flex gap-2">
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
                <th className="p-3 w-8"></th>
                <th className="p-3">유형</th>
                <th className="p-3">이름</th>
                <th className="p-3">제조사/모델</th>
                <th className="p-3">IP</th>
                <th className="p-3">OS</th>
                <th className="p-3">관리자</th>
                <th className="p-3">부서</th>
                <th className="p-3">위치</th>
                <th className="p-3">상태</th>
                <th className="p-3 w-20">관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <>
                  <tr key={a.id} className="border-b last:border-0 hover:bg-slate-50 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}>
                    <td className="p-3 text-slate-400">
                      {expandedId === a.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${typeColors[a.asset_type]}`}>
                        {typeLabels[a.asset_type]}
                      </span>
                    </td>
                    <td className="p-3 font-medium">{a.name}</td>
                    <td className="p-3 text-slate-500 text-xs">{a.manufacturer} {a.model}</td>
                    <td className="p-3 font-mono text-xs text-slate-500">{a.ip_address}</td>
                    <td className="p-3 text-xs text-slate-500">{a.os || "-"}</td>
                    <td className="p-3 text-xs text-slate-500">{a.admin_name || "-"}</td>
                    <td className="p-3 text-xs text-slate-500">{a.department || "-"}</td>
                    <td className="p-3 text-xs text-slate-500">
                      {a.rack_name ? `${a.location_name}/${a.rack_name} (${a.rack_unit_start}U)` : "-"}
                    </td>
                    <td className="p-3">
                      <span className={`text-xs font-medium ${a.status === "active" ? "text-green-600" : a.status === "maintenance" ? "text-amber-600" : "text-slate-400"}`}>
                        {statusLabels[a.status]}
                      </span>
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
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
                  {/* 확장 상세 */}
                  {expandedId === a.id && (
                    <tr key={`${a.id}-detail`} className="bg-slate-50 border-b">
                      <td colSpan={11} className="p-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
                          <DetailItem label="시리얼" value={a.serial_number} />
                          <DetailItem label="자산태그" value={a.asset_tag} />
                          <DetailItem label="접근 IP" value={a.access_ip} />
                          <DetailItem label="사용자" value={a.user_name} />
                          <DetailItem label="설명" value={a.description} />
                          {/* 커스텀 필드 값 */}
                          {getFieldsForType(a.asset_type).map((f) => (
                            <DetailItem key={f.id} label={f.field_label} value={cvMap[a.id]?.[f.id]} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="p-8 text-center text-slate-400">등록된 자산이 없습니다.</td></tr>
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

function DetailItem({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <span className="text-slate-400">{label}</span>
      <p className="font-medium text-slate-700 mt-0.5">{value || "-"}</p>
    </div>
  );
}

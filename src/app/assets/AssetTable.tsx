"use client";

import { useState } from "react";
import {
  Plus, Search, Pencil, Trash2, X, Save, ChevronDown, ChevronUp,
  Settings, Upload, Download, FileSpreadsheet, AlertCircle, History,
} from "lucide-react";

const typeLabels: Record<string, string> = {
  server: "서버", network: "네트워크", security: "정보보호", telecom: "전화설비", other: "기타",
};
const typeColors: Record<string, string> = {
  server: "bg-slate-100 text-ink",
  network: "bg-slate-100 text-ink",
  security: "bg-slate-100 text-ink",
  telecom: "bg-slate-100 text-ink",
  other: "bg-slate-100 text-ink",
};
const statusLabels: Record<string, string> = {
  active: "운용중", inactive: "미사용", maintenance: "점검중", decommissioned: "폐기", eos: "EoS(단종)",
};
const statusColors: Record<string, string> = {
  active: "text-signal", inactive: "text-idle", maintenance: "text-warn",
  decommissioned: "text-idle", eos: "text-fault",
};
const statusLed: Record<string, string> = {
  active: "led-up", inactive: "led-idle", maintenance: "led-warn",
  decommissioned: "led-idle", eos: "led-fault",
};

interface Asset {
  id: number;
  asset_type: string;
  asset_name: string;

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
  purchase_date: string;
  warranty_date: string;
  eos_date: string;
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
  field_group: string;
  options: string;
  asset_types: string;
  sort_order: number;
  is_required: number;
  show_in_table: number;
  show_in_detail: number;
}

const emptyAsset = {
  asset_type: "server", asset_name: "", manufacturer: "", model: "",
  serial_number: "", ip_address: "", asset_tag: "", status: "active",
  os: "", access_ip: "", user_name: "", admin_name: "", department: "",
  purchase_date: "", warranty_date: "", eos_date: "",
  rack_id: null as number | null, rack_unit_start: null as number | null,
  rack_unit_size: 1, description: "",
};


interface Props {
  assets: Asset[];
  racks: any[];
  customFields: CustomField[];
  customValuesMap: Record<number, Record<number, string>>;
  initialRackId?: string | null;
}

export function AssetTable({ assets: initialAssets, racks, customFields: initFields, customValuesMap: initCvMap, initialRackId }: Props) {
  const [assets, setAssets] = useState(initialAssets);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [rackFilter, setRackFilter] = useState<string>(initialRackId || "");
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
    field_key: "", field_label: "", field_type: "text", field_group: "기본",
    options: "", asset_types: "", is_required: 0, show_in_table: 0, show_in_detail: 1,
  });
  const [editFieldId, setEditFieldId] = useState<number | null>(null);

  // 일괄등록
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importing, setImporting] = useState(false);


  // 테이블에 표시할 커스텀 필드
  const tableCustomFields = customFields.filter((f) => f.show_in_table);

  const filtered = assets.filter((a) => {
    if (typeFilter && a.asset_type !== typeFilter) return false;
    if (rackFilter && a.rack_id !== Number(rackFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        a.asset_name.toLowerCase().includes(q) ||

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

  function getFieldsForType(assetType: string) {
    return customFields.filter((f) => {
      if (!f.asset_types) return true;
      return f.asset_types.split(",").map((s: string) => s.trim()).includes(assetType);
    });
  }

  // 그룹별로 필드 분류
  function getFieldsByGroup(assetType: string) {
    const fields = getFieldsForType(assetType);
    const groups: Record<string, CustomField[]> = {};
    for (const f of fields) {
      const g = f.field_group || "기본";
      if (!groups[g]) groups[g] = [];
      groups[g].push(f);
    }
    return groups;
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
    if (res.ok) setAssets((prev) => prev.filter((a) => a.id !== id));
  }

  function startEdit(asset: Asset) {
    setForm({
      asset_type: asset.asset_type, asset_name: asset.asset_name, manufacturer: asset.manufacturer,
      model: asset.model, serial_number: asset.serial_number, ip_address: asset.ip_address,
      asset_tag: asset.asset_tag, status: asset.status, os: asset.os,
      access_ip: asset.access_ip, user_name: asset.user_name, admin_name: asset.admin_name,
      department: asset.department, purchase_date: asset.purchase_date, warranty_date: asset.warranty_date,
      eos_date: asset.eos_date, rack_id: asset.rack_id, rack_unit_start: asset.rack_unit_start,
      rack_unit_size: asset.rack_unit_size, description: asset.description,
    });

    setCustomValues(cvMap[asset.id] || {});
    setEditId(asset.id);
    setShowForm(true);
  }

  // --- 커스텀 필드 관리 함수 ---
  async function addCustomField() {
    if (!fieldForm.field_key || !fieldForm.field_label) return;
    const res = await fetch("/api/custom-fields", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fieldForm),
    });
    if (res.ok) {
      const data = await res.json();
      setCustomFields((prev) => [...prev, data]);
      resetFieldForm();
    }
  }

  async function saveCustomField() {
    if (!editFieldId || !fieldForm.field_label) return;
    const res = await fetch(`/api/custom-fields/${editFieldId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fieldForm),
    });
    if (res.ok) {
      const data = await res.json();
      setCustomFields((prev) => prev.map((f) => (f.id === editFieldId ? { ...f, ...data } : f)));
      setEditFieldId(null);
      resetFieldForm();
    }
  }

  function startEditField(f: CustomField) {
    setEditFieldId(f.id);
    setFieldForm({
      field_key: f.field_key, field_label: f.field_label, field_type: f.field_type,
      field_group: f.field_group || "기본", options: f.options, asset_types: f.asset_types,
      is_required: f.is_required, show_in_table: f.show_in_table, show_in_detail: f.show_in_detail,
    });
  }

  function resetFieldForm() {
    setEditFieldId(null);
    setFieldForm({
      field_key: "", field_label: "", field_type: "text", field_group: "기본",
      options: "", asset_types: "", is_required: 0, show_in_table: 0, show_in_detail: 1,
    });
  }

  async function deleteCustomField(id: number) {
    if (!confirm("이 필드를 비활성화하시겠습니까?")) return;
    const res = await fetch(`/api/custom-fields/${id}`, { method: "DELETE" });
    if (res.ok) {
      setCustomFields((prev) => prev.filter((f) => f.id !== id));
      if (editFieldId === id) resetFieldForm();
    }
  }

  // 커스텀 필드 값 렌더링
  function renderCustomValue(f: CustomField, value: string | undefined) {
    if (!value) return "-";
    if (f.field_type === "multi-text") {
      try {
        const arr = JSON.parse(value);
        return Array.isArray(arr) ? arr.join(", ") : value;
      } catch { return value; }
    }
    return value;
  }

  // 커스텀 필드 입력 렌더링
  function renderCustomInput(f: CustomField) {
    const val = customValues[f.id] || "";
    if (f.field_type === "select") {
      return (
        <select value={val} onChange={(e) => setCustomValues({ ...customValues, [f.id]: e.target.value })} className="form-input">
          <option value="">선택</option>
          {f.options.split(",").map((opt: string) => <option key={opt.trim()} value={opt.trim()}>{opt.trim()}</option>)}
        </select>
      );
    }
    if (f.field_type === "textarea") {
      return <textarea value={val} onChange={(e) => setCustomValues({ ...customValues, [f.id]: e.target.value })} className="form-input" rows={2} />;
    }
    if (f.field_type === "multi-text") {
      let items: string[] = [];
      try { items = val ? JSON.parse(val) : []; } catch { items = val ? [val] : []; }
      return (
        <div className="space-y-1">
          {items.map((item, i) => (
            <div key={i} className="flex gap-1">
              <input value={item} onChange={(e) => {
                const newItems = [...items]; newItems[i] = e.target.value;
                setCustomValues({ ...customValues, [f.id]: JSON.stringify(newItems) });
              }} className="form-input flex-1" />
              <button type="button" onClick={() => {
                const newItems = items.filter((_, j) => j !== i);
                setCustomValues({ ...customValues, [f.id]: JSON.stringify(newItems) });
              }} className="text-ink-3 hover:text-fault px-1"><X size={14} /></button>
            </div>
          ))}
          <button type="button" onClick={() => {
            setCustomValues({ ...customValues, [f.id]: JSON.stringify([...items, ""]) });
          }} className="text-xs text-ink-2 hover:text-ink">+ 추가</button>
        </div>
      );
    }
    return (
      <input
        type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
        value={val}
        onChange={(e) => setCustomValues({ ...customValues, [f.id]: e.target.value })}
        className="form-input"
      />
    );
  }

  return (
    <div>
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input type="text" placeholder="이름, IP, 제조사, OS, 관리자, 부서 검색..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="form-input w-full pl-9" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="form-input">
          <option value="">전체 유형</option>
          {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={rackFilter} onChange={(e) => setRackFilter(e.target.value)}
          className="form-input">
          <option value="">전체 랙</option>
          {racks.map((r: any) => <option key={r.id} value={r.id}>{r.rack_name} ({r.location_name})</option>)}
        </select>
        <button onClick={() => { setShowForm(true); setEditId(null); setForm(emptyAsset); setCustomValues({}); }}
          className="btn-ink flex items-center gap-1.5">
          <Plus size={16} /> 자산 등록
        </button>
        <button onClick={() => setShowFieldManager(!showFieldManager)}
          className="flex items-center gap-1.5 border border-line px-3 py-2 rounded-lg text-sm hover:bg-slate-100 text-ink-2">
          <Settings size={16} /> 확장필드
        </button>
        <button onClick={() => { setShowBulkImport(true); setImportResult(null); }}
          className="flex items-center gap-1.5 border border-line px-3 py-2 rounded-lg text-sm hover:bg-slate-100 text-ink-2">
          <Upload size={16} /> 일괄등록
        </button>
        <a href="/api/assets/export"
          className="flex items-center gap-1.5 border border-line px-3 py-2 rounded-lg text-sm hover:bg-slate-100 text-ink-2">
          <Download size={16} /> 내보내기
        </a>
      </div>

      {/* 확장필드 관리 */}
      {showFieldManager && (
        <div className="panel p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-ink">확장 필드 관리</h3>
            <button onClick={() => setShowFieldManager(false)} className="text-ink-3 hover:text-ink"><X size={16} /></button>
          </div>
          <p className="text-xs text-ink-3 mb-3">자산에 추가할 속성을 정의합니다. 그룹별로 폼에 섹션이 생기고, 테이블표시를 켜면 목록에 컬럼이 추가됩니다.</p>

          {customFields.length > 0 && (
            <div className="mb-4 space-y-1">
              {customFields.map((f) => (
                editFieldId === f.id ? (
                  <div key={f.id} className="grid grid-cols-2 md:grid-cols-9 gap-1.5 bg-slate-100 rounded px-3 py-2 items-center text-xs">
                    <input value={fieldForm.field_key} disabled className="form-input text-xs bg-slate-100" title="키는 변경 불가" />
                    <input value={fieldForm.field_label} onChange={(e) => setFieldForm({ ...fieldForm, field_label: e.target.value })} className="form-input text-xs" placeholder="라벨" />
                    <select value={fieldForm.field_type} onChange={(e) => setFieldForm({ ...fieldForm, field_type: e.target.value })} className="form-input text-xs">
                      <option value="text">텍스트</option><option value="number">숫자</option><option value="date">날짜</option>
                      <option value="select">선택</option><option value="textarea">텍스트영역</option><option value="multi-text">다중값</option>
                    </select>
                    <input value={fieldForm.field_group} onChange={(e) => setFieldForm({ ...fieldForm, field_group: e.target.value })} className="form-input text-xs" placeholder="그룹" />
                    <input value={fieldForm.options} onChange={(e) => setFieldForm({ ...fieldForm, options: e.target.value })} className="form-input text-xs" placeholder="옵션(콤마)" />
                    <input value={fieldForm.asset_types} onChange={(e) => setFieldForm({ ...fieldForm, asset_types: e.target.value })} className="form-input text-xs" placeholder="유형필터" />
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!fieldForm.show_in_table} onChange={(e) => setFieldForm({ ...fieldForm, show_in_table: e.target.checked ? 1 : 0 })} /> 테이블</label>
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!fieldForm.is_required} onChange={(e) => setFieldForm({ ...fieldForm, is_required: e.target.checked ? 1 : 0 })} /> 필수</label>
                    <div className="flex gap-1">
                      <button onClick={saveCustomField} className="bg-ink hover:bg-rail text-white rounded text-xs px-2 py-1">저장</button>
                      <button onClick={resetFieldForm} className="border border-line rounded text-xs px-2 py-1">취소</button>
                    </div>
                  </div>
                ) : (
                  <div key={f.id} className="flex items-center justify-between bg-panel border border-line rounded px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{f.field_label}</span>
                      <span className="text-ink-3 text-xs">({f.field_key})</span>
                      <span className="text-xs px-1.5 py-0.5 bg-slate-100 rounded">{f.field_type}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-ink rounded">{f.field_group}</span>
                      {f.show_in_table ? <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-ink rounded">테이블</span> : null}
                      {f.is_required ? <span className="text-xs px-1.5 py-0.5 bg-red-50 text-fault rounded">필수</span> : null}
                      {f.asset_types && <span className="text-xs text-ink-3">{f.asset_types}</span>}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => startEditField(f)} className="text-ink-2 hover:text-ink hover:bg-slate-100 rounded p-1"><Pencil size={14} /></button>
                      <button onClick={() => deleteCustomField(f.id)} className="text-fault hover:bg-red-50 rounded p-1"><Trash2 size={14} /></button>
                    </div>
                  </div>
                )
              ))}
            </div>
          )}

          {!editFieldId && (
            <div className="grid grid-cols-2 md:grid-cols-9 gap-1.5 text-xs">
              <input placeholder="키(영문)" value={fieldForm.field_key} onChange={(e) => setFieldForm({ ...fieldForm, field_key: e.target.value })} className="form-input text-xs" />
              <input placeholder="라벨" value={fieldForm.field_label} onChange={(e) => setFieldForm({ ...fieldForm, field_label: e.target.value })} className="form-input text-xs" />
              <select value={fieldForm.field_type} onChange={(e) => setFieldForm({ ...fieldForm, field_type: e.target.value })} className="form-input text-xs">
                <option value="text">텍스트</option><option value="number">숫자</option><option value="date">날짜</option>
                <option value="select">선택</option><option value="textarea">텍스트영역</option><option value="multi-text">다중값</option>
              </select>
              <input placeholder="그룹명" value={fieldForm.field_group} onChange={(e) => setFieldForm({ ...fieldForm, field_group: e.target.value })} className="form-input text-xs" />
              <input placeholder="옵션(콤마)" value={fieldForm.options} onChange={(e) => setFieldForm({ ...fieldForm, options: e.target.value })} className="form-input text-xs" />
              <input placeholder="유형필터" value={fieldForm.asset_types} onChange={(e) => setFieldForm({ ...fieldForm, asset_types: e.target.value })} className="form-input text-xs" />
              <label className="flex items-center gap-1"><input type="checkbox" checked={!!fieldForm.show_in_table} onChange={(e) => setFieldForm({ ...fieldForm, show_in_table: e.target.checked ? 1 : 0 })} /> 테이블</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={!!fieldForm.is_required} onChange={(e) => setFieldForm({ ...fieldForm, is_required: e.target.checked ? 1 : 0 })} /> 필수</label>
              <button onClick={addCustomField} className="bg-ink hover:bg-rail text-white rounded text-xs py-1.5">추가</button>
            </div>
          )}
        </div>
      )}

      {/* 일괄등록 */}
      {showBulkImport && (
        <div className="panel p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2"><FileSpreadsheet size={18} /> 자산 일괄등록</h3>
            <button onClick={() => setShowBulkImport(false)} className="text-ink-3 hover:text-ink"><X size={18} /></button>
          </div>
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-slate-100 rounded-lg">
              <span className="num bg-ink text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">1</span>
              <div>
                <p className="text-sm font-medium">양식 다운로드</p>
                <p className="text-xs text-ink-3 mt-1">엑셀 양식을 다운로드하여 자산 정보를 입력합니다.</p>
                <a href="/api/assets/template" className="inline-flex items-center gap-1.5 mt-2 bg-ink hover:bg-rail text-white px-3 py-1.5 rounded text-xs">
                  <Download size={14} /> 양식 다운로드 (.xlsx)
                </a>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-slate-100 rounded-lg">
              <span className="num bg-ink text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">2</span>
              <div className="flex-1">
                <p className="text-sm font-medium">양식 업로드</p>
                <p className="text-xs text-ink-3 mt-1">작성한 엑셀 파일을 업로드하면 자동으로 자산이 등록됩니다.</p>
                <input type="file" accept=".xlsx,.xls" disabled={importing} className="mt-2 text-sm"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]; if (!file) return;
                    setImporting(true); setImportResult(null);
                    const fd = new FormData(); fd.append("file", file);
                    try {
                      const res = await fetch("/api/assets/import", { method: "POST", body: fd });
                      const data = await res.json(); setImportResult(data);
                      if (data.imported > 0) {
                        const r = await fetch("/api/assets"); if (r.ok) setAssets(await r.json());
                      }
                    } catch { setImportResult({ success: false, error: "업로드 실패" }); }
                    finally { setImporting(false); e.target.value = ""; }
                  }} />
                {importing && <p className="text-xs text-ink-2 mt-2">업로드 중...</p>}
              </div>
            </div>
            {importResult && (
              <div className={`p-4 rounded-lg ${importResult.errors?.length > 0 ? "bg-red-50 border border-fault/30" : "bg-green-50 border border-signal/30"}`}>
                <div className="flex items-center gap-2 mb-2">
                  {importResult.errors?.length > 0 ? <AlertCircle size={16} className="text-fault" /> : <FileSpreadsheet size={16} className="text-signal" />}
                  <span className="font-medium text-sm">
                    {importResult.imported > 0 && `${importResult.imported}건 등록`}{importResult.imported > 0 && importResult.errors?.length > 0 && " / "}
                    {importResult.errors?.length > 0 && `${importResult.errors.length}건 오류`}{importResult.error && importResult.error}
                  </span>
                </div>
                {importResult.errors?.length > 0 && (
                  <table className="w-full text-xs mt-2"><thead><tr className="text-left text-ink-3 border-b border-line">
                    <th className="pb-1 pr-2">행</th><th className="pb-1 pr-2">컬럼</th><th className="pb-1 pr-2">값</th><th className="pb-1">오류</th>
                  </tr></thead><tbody>
                    {importResult.errors.map((err: any, i: number) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="py-1 pr-2 text-fault num">{err.row}</td>
                        <td className="py-1 pr-2 font-medium">{err.column}</td>
                        <td className="py-1 pr-2 text-ink-3 truncate max-w-[150px]">{err.value || "-"}</td>
                        <td className="py-1 text-fault">{err.error}</td>
                      </tr>
                    ))}
                  </tbody></table>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 등록/수정 폼 */}
      {showForm && (
        <div className="panel p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-ink">{editId ? "자산 수정" : "자산 등록"}</h3>
            <button onClick={() => { setShowForm(false); setEditId(null); }} className="text-ink-3 hover:text-ink"><X size={18} /></button>
          </div>

          {/* 기본 정보 */}
          <h4 className="eyebrow block mb-2">기본 정보</h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <FormField label="유형 *">
              <select value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })} className="form-input">
                {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </FormField>
            <FormField label="이름 *"><input value={form.asset_name} onChange={(e) => setForm({ ...form, asset_name: e.target.value })} className="form-input" /></FormField>

            <FormField label="제조사"><input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} className="form-input" /></FormField>
            <FormField label="모델"><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="form-input" /></FormField>
            <FormField label="시리얼"><input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} className="form-input" /></FormField>
            <FormField label="IP 주소"><input value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} className="form-input" placeholder="대표 IP" /></FormField>
            <FormField label="자산태그"><input value={form.asset_tag} onChange={(e) => setForm({ ...form, asset_tag: e.target.value })} className="form-input" /></FormField>
            <FormField label="상태">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="form-input">
                {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </FormField>
          </div>

          {/* 운영 정보 */}
          <h4 className="eyebrow block mb-2">운영 정보</h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <FormField label="OS / 펌웨어"><input value={form.os} onChange={(e) => setForm({ ...form, os: e.target.value })} className="form-input" /></FormField>
            <FormField label="접근 IP"><input value={form.access_ip} onChange={(e) => setForm({ ...form, access_ip: e.target.value })} className="form-input" /></FormField>
            <FormField label="사용자"><input value={form.user_name} onChange={(e) => setForm({ ...form, user_name: e.target.value })} className="form-input" /></FormField>
            <FormField label="관리자"><input value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} className="form-input" /></FormField>
            <FormField label="부서"><input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="form-input" /></FormField>
            <FormField label="설명"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="form-input" /></FormField>
          </div>

          {/* 랙 배치 */}
          <h4 className="eyebrow block mb-2">랙 배치</h4>
          {(() => {
            const selectedRack = racks.find((r: any) => r.id === form.rack_id);
            const maxU = selectedRack?.total_units ?? 42;
            const maxStart = Math.max(1, maxU - (form.rack_unit_size ?? 1) + 1);
            const maxSize = form.rack_unit_start ? Math.max(1, maxU - form.rack_unit_start + 1) : maxU;
            return (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                <FormField label="설치 랙">
                  <select value={form.rack_id ?? ""} onChange={(e) => setForm({ ...form, rack_id: e.target.value ? Number(e.target.value) : null, rack_unit_start: null, rack_unit_size: 1 })} className="form-input">
                    <option value="">미설치</option>
                    {racks.map((r: any) => <option key={r.id} value={r.id}>{r.rack_name} ({r.location_name}) — {r.total_units}U</option>)}

                  </select>
                </FormField>
                <FormField label={`시작 U${selectedRack ? ` (1~${maxStart})` : ""}`}>
                  <input type="number" min={1} max={maxStart} value={form.rack_unit_start ?? ""} disabled={!form.rack_id}
                    onChange={(e) => setForm({ ...form, rack_unit_start: e.target.value ? Math.min(Math.max(1, Number(e.target.value)), maxStart) : null })}
                    className="form-input" placeholder={form.rack_id ? `1~${maxStart}` : "랙 선택"} />
                </FormField>
                <FormField label={`크기 U${selectedRack ? ` (1~${maxSize})` : ""}`}>
                  <input type="number" min={1} max={maxSize} value={form.rack_unit_size} disabled={!form.rack_id}
                    onChange={(e) => setForm({ ...form, rack_unit_size: Math.min(Math.max(1, Number(e.target.value) || 1), maxSize) })}
                    className="form-input" placeholder={form.rack_id ? `1~${maxSize}` : "랙 선택"} />
                </FormField>
              </div>
            );
          })()}
          {/* 날짜 / 계약 */}
          <h4 className="eyebrow block mb-2">날짜 / 계약</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <FormField label="구매일"><input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} className="form-input" /></FormField>
            <FormField label="보증만료"><input type="date" value={form.warranty_date} onChange={(e) => setForm({ ...form, warranty_date: e.target.value })} className="form-input" /></FormField>
            <FormField label="EoS 일자"><input type="date" value={form.eos_date} onChange={(e) => setForm({ ...form, eos_date: e.target.value })} className="form-input" /></FormField>
          </div>


          {/* 커스텀 필드 — 그룹별 섹션 */}
          {(() => {
            const groups = getFieldsByGroup(form.asset_type);
            const groupNames = Object.keys(groups);
            if (groupNames.length === 0) return null;
            return groupNames.map((groupName) => (
              <div key={groupName}>
                <h4 className="eyebrow block mb-2">{groupName}</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                  {groups[groupName].map((f) => (
                    <FormField key={f.id} label={`${f.field_label}${f.is_required ? " *" : ""}`}>
                      {renderCustomInput(f)}
                    </FormField>
                  ))}
                </div>
              </div>
            ));
          })()}

          <div className="flex gap-2">
            <button onClick={handleSave} className="btn-ink flex items-center gap-1.5">
              <Save size={16} /> {editId ? "수정" : "등록"}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null); }} className="px-4 py-2 border border-line rounded-lg text-sm hover:bg-slate-100">취소</button>
          </div>
        </div>
      )}

      {/* 테이블 */}
      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 1200 }}>
            <thead>
              <tr className="bg-surface border-b border-line text-left text-ink-2">
                <th className="p-3 w-8"></th>
                <th className="p-3">유형</th>
                <th className="p-3">이름</th>
                <th className="p-3">제조사/모델</th>
                <th className="p-3">IP</th>
                <th className="p-3">OS</th>
                <th className="p-3">관리자</th>
                <th className="p-3">부서</th>
                {tableCustomFields.map((f) => <th key={f.id} className="p-3 text-xs">{f.field_label}</th>)}
                <th className="p-3">위치</th>
                <th className="p-3">상태</th>
                <th className="p-3 w-28">관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <TableRow key={a.id} asset={a} expanded={expandedId === a.id}
                  onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
                  onEdit={() => startEdit(a)} onDelete={() => handleDelete(a.id)}
                  tableCustomFields={tableCustomFields} allCustomFields={customFields}
                  cvMap={cvMap} renderCustomValue={renderCustomValue}
                  getFieldsForType={getFieldsForType} />
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={12 + tableCustomFields.length} className="p-8 text-center text-ink-3">등록된 자산이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line p-3 text-xs text-ink-3">총 <span className="num">{filtered.length}</span>건</div>
      </div>

    </div>
  );
}

// --- 테이블 행 ---
function TableRow({ asset: a, expanded, onToggle, onEdit, onDelete,
  tableCustomFields, allCustomFields, cvMap, renderCustomValue, getFieldsForType,
}: {
  asset: Asset; expanded: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void;
  tableCustomFields: CustomField[]; allCustomFields: CustomField[];
  cvMap: Record<number, Record<number, string>>;
  renderCustomValue: (f: CustomField, v: string | undefined) => string;
  getFieldsForType: (t: string) => CustomField[];
}) {
  return (
    <>
      <tr className="border-b border-line last:border-0 hover-row cursor-pointer" onClick={onToggle}>
        <td className="p-3 text-ink-3">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
        <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded ${typeColors[a.asset_type]}`}>{typeLabels[a.asset_type]}</span></td>
        <td className="p-3 font-medium">{a.asset_name}</td>
        <td className="p-3 text-ink-3 text-xs">{a.manufacturer} {a.model}</td>
        <td className="p-3 text-xs text-ink-3"><span className="num">{a.ip_address}</span></td>
        <td className="p-3 text-xs text-ink-3">{a.os || "-"}</td>
        <td className="p-3 text-xs text-ink-3">{a.admin_name || "-"}</td>
        <td className="p-3 text-xs text-ink-3">{a.department || "-"}</td>
        {tableCustomFields.map((f) => (
          <td key={f.id} className="p-3 text-xs text-ink-3">{renderCustomValue(f, cvMap[a.id]?.[f.id])}</td>
        ))}
        <td className="p-3 text-xs text-ink-3">{a.rack_name ? <>{a.location_name}/{a.rack_name} (<span className="num">{a.rack_unit_start}</span>U)</> : "-"}</td>
        <td className="p-3"><span className={`inline-flex items-center gap-1.5 text-xs font-medium ${statusColors[a.status] || "text-idle"}`}><span className={`led ${statusLed[a.status] || "led-idle"}`} />{statusLabels[a.status]}</span></td>
        <td className="p-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-0.5">
            <button onClick={onEdit} className="p-1.5 text-ink-2 hover:text-ink hover:bg-slate-100 rounded" title="수정"><Pencil size={14} /></button>
            <button onClick={onDelete} className="p-1.5 text-fault hover:bg-red-50 rounded" title="삭제"><Trash2 size={14} /></button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-surface border-b border-line">
          <td colSpan={12 + tableCustomFields.length} className="p-4">
            {/* 기본 상세 */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs mb-4">
              <DetailItem label="시리얼" value={a.serial_number} />
              <DetailItem label="자산태그" value={a.asset_tag} />
              <DetailItem label="접근 IP" value={a.access_ip} />
              <DetailItem label="사용자" value={a.user_name} />
              <DetailItem label="설명" value={a.description} />
              <DetailItem label="구매일" value={a.purchase_date} />
              <DetailItem label="보증만료" value={a.warranty_date} />
              <DetailItem label="EoS" value={a.eos_date} />
            </div>
            {/* 커스텀 필드 상세 — 그룹별 */}
            {(() => {
              const fields = getFieldsForType(a.asset_type).filter((f: CustomField) => f.show_in_detail);
              if (fields.length === 0) return null;
              const groups: Record<string, CustomField[]> = {};
              for (const f of fields) { const g = f.field_group || "기본"; if (!groups[g]) groups[g] = []; groups[g].push(f); }
              return Object.entries(groups).map(([g, fs]) => (
                <div key={g} className="mb-3">
                  <h5 className="eyebrow block mb-1">{g}</h5>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
                    {fs.map((f: CustomField) => <DetailItem key={f.id} label={f.field_label} value={renderCustomValue(f, cvMap[a.id]?.[f.id])} />)}
                  </div>
                </div>
              ));
            })()}
            {/* 변경이력 */}
            <div className="mt-3">
              <ExpandSection title="변경이력" icon={<History size={14} />} assetId={a.id} />
          </div>
          </td>
        </tr>
      )}
    </>
  );
}

// --- 변경이력 lazy load ---
function ExpandSection({ title, icon, assetId }: { title: string; icon: React.ReactNode; assetId: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any[] | null>(null);

  async function load() {
    if (data !== null) { setOpen(!open); return; }
    const res = await fetch(`/api/assets/${assetId}/logs`);
    if (res.ok) setData(await res.json());
    setOpen(true);
  }

  return (
    <div>
      <button onClick={load} className="flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink mb-2">
        {icon} {title} {open ? "▲" : "▼"}
      </button>
      {open && data && (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {data.length === 0 && <p className="text-xs text-ink-3">변경 이력 없음</p>}
          {data.map((log: any) => (
            <div key={log.id} className="flex items-start gap-2 text-xs">
              <span className="num text-ink-3 shrink-0 w-32">{log.created_at}</span>
              <span className="font-medium shrink-0">{log.changed_by || "-"}</span>
              <span className={`shrink-0 px-1.5 py-0.5 rounded ${
                log.action === "create" ? "bg-green-50 text-signal" :
                log.action === "update" ? "bg-slate-100 text-ink" : "bg-red-50 text-fault"
              }`}>{log.action === "create" ? "등록" : log.action === "update" ? "수정" : "삭제"}</span>
              {log.action === "update" && (
                <span className="text-ink-3 truncate">
                  {(() => { try { return JSON.parse(log.changed_fields).join(", "); } catch { return ""; } })()}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-ink-2 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function DetailItem({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <span className="text-ink-3">{label}</span>
      <p className="font-medium text-ink mt-0.5">{value || "-"}</p>
    </div>
  );
}

"use client";

// 유지관리내역(장애/유지보수/점검) 등록 폼
import type { AssetOption, LogForm as LogFormValues, VendorOption } from "./types";

interface Props {
  form: LogFormValues;
  onChange: (form: LogFormValues) => void;
  assets: AssetOption[];
  vendors: VendorOption[];
  onSubmit: () => void;
}

export function LogForm({ form, onChange, assets, vendors, onSubmit }: Props) {
  return (
    <div className="panel p-4 space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block eyebrow mb-1">자산 *</label>
          <select className="form-input w-full px-2 py-1.5 text-sm" value={form.asset_id} onChange={(e) => onChange({ ...form, asset_id: e.target.value })}>
            <option value="">선택</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.asset_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block eyebrow mb-1">유형</label>
          <select className="form-input w-full px-2 py-1.5 text-sm" value={form.log_type} onChange={(e) => onChange({ ...form, log_type: e.target.value })}>
            <option value="failure">장애</option>
            <option value="maintenance">유지보수</option>
            <option value="inspection">점검</option>
          </select>
        </div>
        <div>
          <label className="block eyebrow mb-1">심각도</label>
          <select className="form-input w-full px-2 py-1.5 text-sm" value={form.severity} onChange={(e) => onChange({ ...form, severity: e.target.value })}>
            <option value="critical">심각</option>
            <option value="major">주요</option>
            <option value="minor">경미</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block eyebrow mb-1">발생일시</label>
          <input type="datetime-local" className="form-input w-full px-2 py-1.5 text-sm" value={form.occurred_at} onChange={(e) => onChange({ ...form, occurred_at: e.target.value })} />
        </div>
        <div>
          <label className="block eyebrow mb-1">업체</label>
          <select className="form-input w-full px-2 py-1.5 text-sm" value={form.vendor_id} onChange={(e) => onChange({ ...form, vendor_id: e.target.value })}>
            <option value="">없음</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.vendor_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block eyebrow mb-1">비용</label>
          <input type="text" className="form-input w-full px-2 py-1.5 text-sm" placeholder="예: 500,000원" value={form.cost} onChange={(e) => onChange({ ...form, cost: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="block eyebrow mb-1">증상</label>
        <textarea className="form-input w-full px-2 py-1.5 text-sm" rows={2} value={form.symptom} onChange={(e) => onChange({ ...form, symptom: e.target.value })} />
      </div>
      <div>
        <label className="block eyebrow mb-1">조치내용</label>
        <textarea className="form-input w-full px-2 py-1.5 text-sm" rows={2} value={form.action_taken} onChange={(e) => onChange({ ...form, action_taken: e.target.value })} />
      </div>
      <div>
        <label className="block eyebrow mb-1">비고</label>
        <input type="text" className="form-input w-full px-2 py-1.5 text-sm" value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} />
      </div>
      <div className="flex justify-end">
        <button className="btn-ink px-4 py-2 text-sm" onClick={onSubmit}>등록</button>
      </div>
    </div>
  );
}

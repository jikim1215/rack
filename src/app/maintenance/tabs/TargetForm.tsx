"use client";

// 유지관리 대상/금액 등록·수정 폼
import { X } from "lucide-react";
import type { AssetOption, TargetForm as TargetFormValues } from "./types";

interface Props {
  form: TargetFormValues;
  editing: boolean;
  onPatch: (patch: Partial<TargetFormValues>) => void;
  assets: AssetOption[];
  onSubmit: () => void;
  onCancel: () => void;
}

export function TargetForm({ form, editing, onPatch, assets, onSubmit, onCancel }: Props) {
  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{editing ? "유지관리 대상 수정" : "유지관리 대상 등록"}</h3>
        <button className="text-ink-3 hover:text-ink" onClick={onCancel}><X className="h-4 w-4" /></button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block eyebrow mb-1">연결 자산(선택)</label>
          <select className="form-input w-full px-2 py-1.5 text-sm" value={form.asset_id} onChange={(e) => onPatch({ asset_id: e.target.value })}>
            <option value="">없음(수기 입력)</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.asset_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block eyebrow mb-1">정보시스템명</label>
          <input className="form-input w-full px-2 py-1.5 text-sm" value={form.system_name} onChange={(e) => onPatch({ system_name: e.target.value })} />
        </div>
        <div>
          <label className="block eyebrow mb-1">구분</label>
          <input className="form-input w-full px-2 py-1.5 text-sm" placeholder="서버/네트워크/저장장치" value={form.category} onChange={(e) => onPatch({ category: e.target.value })} />
        </div>
        <div>
          <label className="block eyebrow mb-1">유형</label>
          <input className="form-input w-full px-2 py-1.5 text-sm" value={form.asset_type_label} onChange={(e) => onPatch({ asset_type_label: e.target.value })} />
        </div>
        <div>
          <label className="block eyebrow mb-1">정보자원명</label>
          <input className="form-input w-full px-2 py-1.5 text-sm" value={form.resource_name} onChange={(e) => onPatch({ resource_name: e.target.value })} />
        </div>
        <div>
          <label className="block eyebrow mb-1">수량</label>
          <input type="number" min={1} className="form-input w-full px-2 py-1.5 text-sm" value={form.quantity} onChange={(e) => onPatch({ quantity: e.target.value })} />
        </div>
        <div>
          <label className="block eyebrow mb-1">제조사</label>
          <input className="form-input w-full px-2 py-1.5 text-sm" value={form.manufacturer} onChange={(e) => onPatch({ manufacturer: e.target.value })} />
        </div>
        <div>
          <label className="block eyebrow mb-1">호스트명</label>
          <input className="form-input w-full px-2 py-1.5 text-sm" value={form.host_name} onChange={(e) => onPatch({ host_name: e.target.value })} />
        </div>
        <div className="col-span-2">
          <label className="block eyebrow mb-1">용도</label>
          <input className="form-input w-full px-2 py-1.5 text-sm" value={form.purpose} onChange={(e) => onPatch({ purpose: e.target.value })} />
        </div>
        <div>
          <label className="block eyebrow mb-1">위치</label>
          <input className="form-input w-full px-2 py-1.5 text-sm" placeholder="지역/건물/층" value={form.location_text} onChange={(e) => onPatch({ location_text: e.target.value })} />
        </div>
        <div>
          <label className="block eyebrow mb-1">랙위치</label>
          <input className="form-input w-full px-2 py-1.5 text-sm" value={form.rack_position} onChange={(e) => onPatch({ rack_position: e.target.value })} />
        </div>
        <div>
          <label className="block eyebrow mb-1">자산코드</label>
          <input className="form-input w-full px-2 py-1.5 text-sm" value={form.asset_code} onChange={(e) => onPatch({ asset_code: e.target.value })} />
        </div>
        <div>
          <label className="block eyebrow mb-1">자산사용부서</label>
          <input className="form-input w-full px-2 py-1.5 text-sm" value={form.owner_department} onChange={(e) => onPatch({ owner_department: e.target.value })} />
        </div>
        <div>
          <label className="block eyebrow mb-1">자산사용자</label>
          <input className="form-input w-full px-2 py-1.5 text-sm" value={form.owner_user} onChange={(e) => onPatch({ owner_user: e.target.value })} />
        </div>
        <div>
          <label className="block eyebrow mb-1">취득일자</label>
          <input type="date" className="form-input w-full px-2 py-1.5 text-sm" value={form.acquisition_date} onChange={(e) => onPatch({ acquisition_date: e.target.value })} />
        </div>
        <div>
          <label className="block eyebrow mb-1">도입금액</label>
          <input className="form-input w-full px-2 py-1.5 text-sm" value={form.acquisition_amount} onChange={(e) => onPatch({ acquisition_amount: e.target.value })} />
        </div>
      </div>

      <div className="border-t border-line pt-3">
        <div className="eyebrow mb-2">유지관리 기간 · 산정</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block eyebrow mb-1">유지보수 시작</label>
            <input type="date" className="form-input w-full px-2 py-1.5 text-sm" value={form.maintenance_start} onChange={(e) => onPatch({ maintenance_start: e.target.value })} />
          </div>
          <div>
            <label className="block eyebrow mb-1">유지보수 종료</label>
            <input type="date" className="form-input w-full px-2 py-1.5 text-sm" value={form.maintenance_end} onChange={(e) => onPatch({ maintenance_end: e.target.value })} />
          </div>
          <div>
            <label className="block eyebrow mb-1">기간(개월)</label>
            <input type="number" min={0} className="form-input w-full px-2 py-1.5 text-sm" value={form.maintenance_months} onChange={(e) => onPatch({ maintenance_months: e.target.value })} />
          </div>
          <div>
            <label className="block eyebrow mb-1">업무영향범위</label>
            <input className="form-input w-full px-2 py-1.5 text-sm" value={form.business_impact} onChange={(e) => onPatch({ business_impact: e.target.value })} />
          </div>
          <div>
            <label className="block eyebrow mb-1">데이터중요도</label>
            <input className="form-input w-full px-2 py-1.5 text-sm" value={form.data_importance} onChange={(e) => onPatch({ data_importance: e.target.value })} />
          </div>
          <div>
            <label className="block eyebrow mb-1">이용자수/처리건수</label>
            <input className="form-input w-full px-2 py-1.5 text-sm" value={form.user_traffic} onChange={(e) => onPatch({ user_traffic: e.target.value })} />
          </div>
          <div>
            <label className="block eyebrow mb-1">H/W</label>
            <input className="form-input w-full px-2 py-1.5 text-sm" value={form.hardware_score} onChange={(e) => onPatch({ hardware_score: e.target.value })} />
          </div>
          <div>
            <label className="block eyebrow mb-1">유지보수난이도</label>
            <input className="form-input w-full px-2 py-1.5 text-sm" value={form.maintenance_difficulty} onChange={(e) => onPatch({ maintenance_difficulty: e.target.value })} />
          </div>
          <div>
            <label className="block eyebrow mb-1">유지보수항목</label>
            <input className="form-input w-full px-2 py-1.5 text-sm" value={form.maintenance_scope} onChange={(e) => onPatch({ maintenance_scope: e.target.value })} />
          </div>
          <div>
            <label className="block eyebrow mb-1">측정점수</label>
            <input className="form-input w-full px-2 py-1.5 text-sm" value={form.score_total} onChange={(e) => onPatch({ score_total: e.target.value })} />
          </div>
          <div>
            <label className="block eyebrow mb-1">유지관리등급</label>
            <input className="form-input w-full px-2 py-1.5 text-sm" value={form.grade} onChange={(e) => onPatch({ grade: e.target.value })} />
          </div>
          <div>
            <label className="block eyebrow mb-1">유지관리요율</label>
            <input className="form-input w-full px-2 py-1.5 text-sm" value={form.rate} onChange={(e) => onPatch({ rate: e.target.value })} />
          </div>
          <div>
            <label className="block eyebrow mb-1">추정금액(계산)</label>
            <input className="form-input w-full px-2 py-1.5 text-sm" value={form.estimated_amount_calc} onChange={(e) => onPatch({ estimated_amount_calc: e.target.value })} />
          </div>
          <div>
            <label className="block eyebrow mb-1">추정금액(입력)</label>
            <input className="form-input w-full px-2 py-1.5 text-sm" value={form.estimated_amount_input} onChange={(e) => onPatch({ estimated_amount_input: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="block eyebrow mb-1">근거자료</label>
            <input className="form-input w-full px-2 py-1.5 text-sm" value={form.evidence_note} onChange={(e) => onPatch({ evidence_note: e.target.value })} />
          </div>
        </div>
      </div>

      <div>
        <label className="block eyebrow mb-1">비고</label>
        <input className="form-input w-full px-2 py-1.5 text-sm" value={form.notes} onChange={(e) => onPatch({ notes: e.target.value })} />
      </div>

      <div className="flex justify-end gap-2">
        <button className="px-4 py-2 text-sm text-ink-2 hover:text-ink" onClick={onCancel}>취소</button>
        <button className="btn-ink px-4 py-2 text-sm" onClick={onSubmit}>{editing ? "수정" : "등록"}</button>
      </div>
    </div>
  );
}

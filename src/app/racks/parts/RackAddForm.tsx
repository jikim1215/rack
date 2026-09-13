"use client";

import { Save, X } from "lucide-react";
import type { Location, Team } from "./types";

interface RackAddFormProps {
  locations: Location[];
  teams: Team[];
  isAdmin: boolean;
  addForm: {
    location_id: number;
    rack_name: string;
    total_units: number;
    description: string;
    team_id: number | "";
  };
  setAddForm: React.Dispatch<
    React.SetStateAction<{
      location_id: number;
      rack_name: string;
      total_units: number;
      description: string;
      team_id: number | "";
    }>
  >;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  addNameRef: React.RefObject<HTMLInputElement | null>;
}

export function RackAddForm({
  locations,
  teams,
  isAdmin,
  addForm,
  setAddForm,
  saving,
  onSave,
  onClose,
  addNameRef,
}: RackAddFormProps) {
  return (
    <div className="panel p-4 mb-6 max-w-2xl">
      <div className="flex justify-between mb-3">
        <h4 className="font-medium text-sm">랙 추가</h4>
        <button onClick={onClose} className="text-ink-2 hover:text-ink hover:bg-slate-100 rounded p-1">
          <X size={16} />
        </button>
      </div>
      <p className="text-xs text-ink-3 mb-2">
        저장하면 <b>이름만</b> 비워지고 위치·총 유닛·설명은 유지됩니다. 이름만 바꿔 Enter 또는 저장으로 같은 위치·크기의 랙을 연속 추가하세요.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-slate-500">위치</span>
          <select
            value={addForm.location_id}
            onChange={(e) => setAddForm({ ...addForm, location_id: Number(e.target.value) })}
            className="form-input"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.location_name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">이름</span>
          <input
            ref={addNameRef}
            value={addForm.rack_name}
            onChange={(e) => setAddForm({ ...addForm, rack_name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSave();
              }
            }}
            className="form-input"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">총 유닛 수</span>
          <select
            value={addForm.total_units}
            onChange={(e) => setAddForm({ ...addForm, total_units: Number(e.target.value) })}
            className="form-input"
          >
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
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">설명</span>
          <input
            value={addForm.description}
            onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
            className="form-input"
          />
        </label>
        {isAdmin && (
          <label className="block">
            <span className="text-xs text-slate-500">소유 팀</span>
            <select
              value={addForm.team_id}
              onChange={(e) =>
                setAddForm({
                  ...addForm,
                  team_id: e.target.value === "" ? "" : Number(e.target.value),
                })
              }
              className="form-input"
            >
              <option value="">공유(미지정) — 공용센터 공용 랙</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.team_name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="btn-ink flex items-center gap-1 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          <Save size={14} /> 저장
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 border border-line rounded text-sm text-ink-2 hover:text-ink hover:bg-slate-100"
        >
          닫기
        </button>
      </div>
    </div>
  );
}

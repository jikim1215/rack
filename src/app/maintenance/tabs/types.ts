// 유지보수 탭(이력/대상) 공유 타입·라벨·상수 모음
import { Wrench, AlertTriangle, ClipboardCheck } from "lucide-react";
import type { MaintenanceLogRow, MaintenanceTargetRow } from "@/lib/db-types";

// 서버(page.tsx)의 JOIN 결과: asset_name 은 자산 삭제 시 null 이 될 수 있어 override 한다.
export interface Log extends Omit<MaintenanceLogRow, "asset_name"> {
  asset_name: string | null;
  vendor_name: string | null;
}

export interface Target extends Omit<MaintenanceTargetRow, "asset_name"> {
  asset_name: string | null;
}

export interface AssetOption {
  id: number;
  asset_name: string;
  asset_tag?: string;
  manufacturer?: string;
  model?: string;
}

export interface VendorOption {
  id: number;
  vendor_name: string;
}

export const typeLabels: Record<string, string> = { failure: "장애", maintenance: "유지보수", inspection: "점검" };
export const typeColors: Record<string, string> = {
  failure: "bg-red-50 text-fault",
  maintenance: "bg-slate-100 text-ink",
  inspection: "bg-green-50 text-signal",
};
export const typeIcons: Record<string, typeof AlertTriangle> = {
  failure: AlertTriangle, maintenance: Wrench, inspection: ClipboardCheck,
};
export const severityLabels: Record<string, string> = { critical: "심각", major: "주요", minor: "경미" };
export const severityColors: Record<string, string> = {
  critical: "bg-red-50 text-fault",
  major: "bg-amber-50 text-warn",
  minor: "bg-slate-100 text-ink",
};
export const statusLabels: Record<string, string> = { open: "미해결", in_progress: "진행중", resolved: "해결" };
export const statusColors: Record<string, string> = {
  open: "text-fault", in_progress: "text-warn", resolved: "text-signal",
};
export const statusLed: Record<string, string> = {
  open: "led-fault", in_progress: "led-warn", resolved: "led-up",
};

export const emptyForm = {
  asset_id: "",
  log_type: "failure",
  severity: "minor",
  occurred_at: "",
  symptom: "",
  action_taken: "",
  vendor_id: "",
  cost: "",
  notes: "",
};

export type LogForm = typeof emptyForm;

export const emptyTarget = {
  asset_id: "",
  system_name: "",
  category: "",
  asset_type_label: "",
  resource_name: "",
  quantity: "1",
  manufacturer: "",
  host_name: "",
  purpose: "",
  location_text: "",
  rack_position: "",
  asset_code: "",
  owner_department: "",
  owner_user: "",
  acquisition_date: "",
  acquisition_amount: "",
  maintenance_start: "",
  maintenance_end: "",
  maintenance_months: "0",
  business_impact: "",
  data_importance: "",
  user_traffic: "",
  hardware_score: "",
  maintenance_difficulty: "",
  maintenance_scope: "",
  score_total: "",
  grade: "",
  rate: "",
  estimated_amount_calc: "",
  estimated_amount_input: "",
  evidence_note: "",
  notes: "",
};

export type TargetForm = typeof emptyTarget;

export function formatAmount(v: string) {
  if (!v) return "-";
  const n = Number(String(v).replace(/,/g, ""));
  if (!Number.isFinite(n) || n === 0) return v;
  return n.toLocaleString("ko-KR");
}

export function targetToForm(t: Target): TargetForm {
  return {
    asset_id: t.asset_id != null ? String(t.asset_id) : "",
    system_name: t.system_name || "",
    category: t.category || "",
    asset_type_label: t.asset_type_label || "",
    resource_name: t.resource_name || "",
    quantity: String(t.quantity ?? 1),
    manufacturer: t.manufacturer || "",
    host_name: t.host_name || "",
    purpose: t.purpose || "",
    location_text: t.location_text || "",
    rack_position: t.rack_position || "",
    asset_code: t.asset_code || "",
    owner_department: t.owner_department || "",
    owner_user: t.owner_user || "",
    acquisition_date: t.acquisition_date || "",
    acquisition_amount: t.acquisition_amount || "",
    maintenance_start: t.maintenance_start || "",
    maintenance_end: t.maintenance_end || "",
    maintenance_months: String(t.maintenance_months ?? 0),
    business_impact: t.business_impact || "",
    data_importance: t.data_importance || "",
    user_traffic: t.user_traffic || "",
    hardware_score: t.hardware_score || "",
    maintenance_difficulty: t.maintenance_difficulty || "",
    maintenance_scope: t.maintenance_scope || "",
    score_total: t.score_total || "",
    grade: t.grade || "",
    rate: t.rate || "",
    estimated_amount_calc: t.estimated_amount_calc || "",
    estimated_amount_input: t.estimated_amount_input || "",
    evidence_note: t.evidence_note || "",
    notes: t.notes || "",
  };
}

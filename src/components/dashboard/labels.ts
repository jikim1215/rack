// ── 대시보드 라벨/색상/아이콘 상수 ──
// page.tsx와 하위 패널들이 공유하는 단일 진실원천. 문구/색을 바꿀 때 여기만 고친다.
import { Server, Network, Shield, Phone, Cable } from "lucide-react";

export const typeLabels: Record<string, string> = {
  server: "서버", network: "네트워크", security: "정보보호", telecom: "전화설비", other: "기타",
};
export const typeIcons: Record<string, typeof Server> = {
  server: Server, network: Network, security: Shield, telecom: Phone, other: Cable,
};
// 자산 유형은 범주 — 색이 아니라 아이콘으로 구분 (색은 상태 신호 전용)
export const typeColors: Record<string, string> = {
  server: "bg-slate-100 text-slate-600",
  network: "bg-slate-100 text-slate-600",
  security: "bg-slate-100 text-slate-600",
  telecom: "bg-slate-100 text-slate-600",
  other: "bg-slate-100 text-slate-600",
};
export const statusLabels: Record<string, string> = {
  active: "운용중", maintenance: "점검중", standby: "예비", retired: "폐기",
};
// 상태별 색상 맵
export const statusColors: Record<string, string> = {
  active: "bg-signal",
  maintenance: "bg-warn",
  standby: "bg-slate-400",
  retired: "bg-fault",
};
export const movementLabels: Record<string, string> = { bring_in: '반입', bring_out: '반출', return: '반납' };
export const movementColors: Record<string, string> = { bring_in: 'text-ink', bring_out: 'text-warn', return: 'text-signal' };
export const severityLabels: Record<string, string> = { critical: '심각', major: '주요', minor: '경미' };
export const severityColors: Record<string, string> = { critical: 'text-fault bg-red-50', major: 'text-warn bg-amber-50', minor: 'text-ink-2 bg-slate-100' };

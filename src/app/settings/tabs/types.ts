// 설정 화면 탭들이 공유하는 타입/상수. SettingsView.tsx 분할본.

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: string;
  is_active: number;
  must_change_password?: number;
  created_at: string;
  team_id: number | null;
  allowed_ips?: string;
  /** 2단계 인증 활성 여부 — 총괄이 기기 분실 계정을 해제할 수 있게 목록에 노출 */
  totp_enabled?: number;
}

export interface Team {
  id: number;
  team_name: string;
  created_at: string;
  user_count: number;
  asset_count: number;
}

export const roleOptions = [
  { value: "admin", label: "총괄" },
  { value: "team", label: "팀" },
  { value: "viewer", label: "전체열람" },
];

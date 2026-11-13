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
  /** 마지막 로그인 성공 시각(없으면 null) */
  last_login_at?: string | null;
  /** 장기 미사용 판정 기준 시각 = 마지막 로그인·생성·재활성화 중 가장 늦은 것 */
  last_activity?: string;
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

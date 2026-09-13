// ── 테이블 행 타입 (src/lib/db.ts 스키마와 1:1) ──
// 라우트/페이지가 `as any` 대신 이 타입으로 SELECT 결과를 받는다(P3). 컬럼을 추가/삭제하면 여기도 같이 고친다.
// JOIN 으로 덧붙는 파생 컬럼(asset_name 등)은 호출부에서 `AssetRow & { rack_name: string }` 처럼 교차한다.

export type Role = "admin" | "team" | "viewer";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  role: Role;
  is_active: number;
  must_change_password: number;
  team_id: number | null;
  token_version: number;
  allowed_ips: string;
  /** 2단계 인증(TOTP) — src/lib/totp.ts */
  totp_secret: string;
  totp_enabled: number;
  totp_last_counter: number;
  /** 1회용 백업 코드 scrypt 해시 JSON 배열 */
  backup_codes: string;
  created_at: string;
}

export interface TeamRow {
  id: number;
  team_name: string;
  created_at: string;
}

export interface MenuPermissionRow {
  id: number;
  menu_key: string;
  role: Role;
  can_access: number;
  can_write: number;
  can_approve: number;
}

export interface LocationRow {
  id: number;
  location_name: string;
  building: string;
  floor: string;
  room: string;
  sort_order: number;
  team_id: number | null;
  created_at: string;
}

export interface RackRow {
  id: number;
  location_id: number;
  rack_name: string;
  total_units: number;
  description: string;
  team_id: number | null;
  created_at: string;
}

export type AssetStatus = "active" | "maintenance" | "standby" | "retired";
export type RackSide = "L" | "R" | null;

export interface AssetRow {
  /** 현행화 도장: 마지막으로 사람이 "값이 맞다" 고 확인한 시각/사용자 (빈 문자열 = 미확인). updated_at 과 다르다. */
  verified_at: string;
  verified_by: string;
  id: number;
  asset_type: string;
  asset_name: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  ip_address: string;
  asset_tag: string;
  status: AssetStatus;
  network_zone: string;
  purchase_date: string;
  warranty_date: string;
  eos_date: string;
  description: string;
  os: string;
  access_ip: string;
  user_name: string;
  admin_name: string;
  department: string;
  team_id: number | null;
  cia_c: number | null;
  cia_i: number | null;
  cia_a: number | null;
  cia_total: number | null;
  cia_grade: string;
  import_batch_id: string | null;
  rack_id: number | null;
  rack_unit_start: number | null;
  rack_unit_size: number;
  rack_side: RackSide;
  created_at: string;
  updated_at: string;
}

export type IpType = "management" | "service" | "backup" | "vip" | "other" | "extra";

export interface AssetIpRow {
  id: number;
  asset_id: number;
  ip_address: string;
  ip_type: IpType;
  interface_name: string;
  subnet_mask: string;
  gateway: string;
  is_primary: number;
  description: string;
  created_at: string;
}

export type CustomFieldType = "text" | "number" | "date" | "select" | "textarea" | "multi-text";

export interface CustomFieldRow {
  id: number;
  field_key: string;
  field_label: string;
  field_type: CustomFieldType;
  field_group: string;
  options: string;
  asset_types: string;
  sort_order: number;
  is_required: number;
  show_in_table: number;
  show_in_detail: number;
  is_active: number;
  created_at: string;
}

export interface CustomValueRow {
  id: number;
  asset_id: number;
  field_id: number;
  value: string;
}

export type FrameType = "110block" | "patch_panel" | "optical" | "other";

export interface DistFrameRow {
  id: number;
  location_id: number;
  rack_id: number | null;
  frame_name: string;
  frame_type: FrameType;
  total_pairs: number;
  rack_unit_start: number | null;
  rack_unit_size: number;
  description: string;
  team_id: number | null;
  created_at: string;
}

export type PairStatus = "used" | "unused" | "reserved" | "faulty";

export interface FramePairRow {
  id: number;
  frame_id: number;
  pair_number: number;
  status: PairStatus;
  label: string;
  source: string;
  destination: string;
  cable_id: string;
  user_info: string;
  description: string;
  core_number: number | null;
  linked_pair_id: number | null;
  connected_port_id: number | null;
}

export type PortType = "ethernet" | "fiber" | "console" | "management" | "sfp" | "sfp_plus" | "qsfp";
export type PortStatus = "used" | "unused" | "reserved" | "disabled";

export interface PortRow {
  id: number;
  asset_id: number;
  port_number: number;
  port_name: string;
  port_type: PortType;
  speed: string;
  connected_to_port_id: number | null;
  vlan: string;
  description: string;
  status: PortStatus;
}

export type VendorType = "maintenance" | "supplier" | "other";

export interface VendorRow {
  id: number;
  vendor_name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  business_number: string;
  vendor_type: VendorType;
  is_active: number;
  notes: string;
  created_at: string;
}

export type ContractType = "maintenance" | "purchase" | "lease" | "other";
export type ContractStatus = "active" | "expired" | "cancelled";

export interface ContractRow {
  id: number;
  vendor_id: number | null;
  contract_name: string;
  contract_type: ContractType;
  start_date: string;
  end_date: string;
  amount: string;
  auto_renew: number;
  status: ContractStatus;
  notes: string;
  team_id: number | null;
  created_at: string;
}

export type MovementType = "bring_in" | "bring_out" | "return";
export type MovementStatus = "requested" | "approved" | "completed" | "rejected";

export interface MovementRow {
  id: number;
  asset_id: number | null;
  movement_type: MovementType;
  movement_date: string;
  requester: string;
  approver: string;
  department: string;
  purpose: string;
  destination: string;
  equipment_desc: string;
  serial_number: string;
  model: string;
  size_u: string;
  manufacturer: string;
  rack_position: string;
  power_watts: string;
  power_redundant: string;
  status: MovementStatus;
  notes: string;
  created_by: string;
  created_at: string;
}

export type MaintenanceLogType = "failure" | "maintenance" | "inspection";
export type MaintenanceSeverity = "critical" | "major" | "minor";
export type MaintenanceStatus = "open" | "in_progress" | "resolved";

export interface MaintenanceLogRow {
  id: number;
  asset_id: number | null;
  asset_name: string;
  log_type: MaintenanceLogType;
  occurred_at: string;
  resolved_at: string;
  reported_by: string;
  handled_by: string;
  severity: MaintenanceSeverity;
  symptom: string;
  action_taken: string;
  vendor_id: number | null;
  cost: string;
  status: MaintenanceStatus;
  notes: string;
  created_at: string;
}

export interface MaintenanceTargetRow {
  id: number;
  asset_id: number | null;
  asset_name: string;
  system_name: string;
  category: string;
  asset_type_label: string;
  resource_name: string;
  quantity: number;
  manufacturer: string;
  host_name: string;
  purpose: string;
  location_text: string;
  rack_position: string;
  asset_code: string;
  owner_department: string;
  owner_user: string;
  acquisition_date: string;
  acquisition_amount: string;
  maintenance_start: string;
  maintenance_end: string;
  maintenance_months: number;
  business_impact: string;
  data_importance: string;
  user_traffic: string;
  hardware_score: string;
  maintenance_difficulty: string;
  maintenance_scope: string;
  score_total: string;
  grade: string;
  rate: string;
  estimated_amount_calc: string;
  estimated_amount_input: string;
  evidence_note: string;
  notes: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface SubnetRow {
  id: number;
  subnet_name: string;
  network_address: string;
  subnet_mask: string;
  gateway: string;
  vlan_id: string;
  location_id: number | null;
  description: string;
  team_id: number | null;
  created_at: string;
}

export type InventoryAuditStatus = "open" | "closed";

export interface InventoryAuditRow {
  id: number;
  audit_name: string;
  status: InventoryAuditStatus;
  started_at: string;
  closed_at: string;
  created_by: string;
  description: string;
  closed_total: number | null;
  closed_checked: number | null;
  closed_mismatch: number | null;
  closed_equip_checked: number | null;
  closed_sub_checked: number | null;
}

export type InventoryCheckResult = "confirmed" | "missing" | "moved" | "disposed";

export interface InventoryAuditCheckRow {
  id: number;
  audit_id: number;
  asset_id: number | null;
  sub_asset_id: number | null;
  result: InventoryCheckResult;
  note: string;
  checked_by: string;
  checked_at: string;
}

export type SubAssetStatus = "active" | "disposed";

export interface SubAssetRow {
  id: number;
  asset_code: string;
  category_major: string;
  category_mid: string;
  category_minor: string;
  sub_name: string;
  spec: string;
  serial_number: string;
  acquired_date: string;
  user_name: string;
  place: string;
  purpose: string;
  note: string;
  status: SubAssetStatus;
  parent_asset_id: number | null;
  team_id: number | null;
  created_at: string;
  updated_at: string;
}

export type AuditEntityType =
  | "asset" | "rack" | "location" | "frame" | "contract" | "movement" | "maintenance"
  | "inventory_audit" | "sub_asset" | "user" | "team" | "permission" | "feedback";
export type AuditAction = "create" | "update" | "delete";

export interface AuditLogRow {
  id: number;
  entity_type: AuditEntityType;
  entity_id: number | null;
  entity_name: string;
  action: AuditAction;
  changed_by: string;
  changed_fields: string;
  old_values: string;
  new_values: string;
  created_at: string;
}

export interface AccessLogRow {
  id: number;
  user_id: number | null;
  username: string;
  ip: string;
  user_agent: string;
  action: "login" | "logout" | "fail";
  result_code: string;
  failure_reason: string;
  created_at: string;
}

export type ImportIssueType = "ip_format" | "missing_id" | "missing_os" | "dup_suspect";
export type ImportIssueStatus = "open" | "resolved" | "ignored";

export interface ImportIssueRow {
  id: number;
  batch_id: string;
  source_row: number | null;
  asset_id: number | null;
  issue_type: ImportIssueType;
  raw_value: string;
  parsed_value: string;
  note: string;
  status: ImportIssueStatus;
  resolved_by: string;
  resolved_at: string;
  created_by: string;
  created_at: string;
}

export interface FeedbackRow {
  id: number;
  category: "bug" | "inconvenience" | "improvement" | "question" | "other";
  title: string;
  content: string;
  page_path: string;
  status: "open" | "in_review" | "planned" | "done" | "rejected";
  priority: "low" | "normal" | "high";
  user_id: number | null;
  created_by: string;
  created_by_name: string;
  team_id: number | null;
  admin_reply: string;
  replied_by: string;
  replied_at: string;
  created_at: string;
  updated_at: string;
}

/** COUNT(*) AS c 형태의 집계 행. */
export interface CountRow { c: number }

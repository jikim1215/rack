// 자산 엑셀 업로드/이관 검증 단일 모듈 (AC-4, ADR-009). 순수 모듈(프레임워크/DB import 없음)이라
// 업로드 API(src/app/api/assets/import)와 1회 이관 스크립트(G011)가 동일 규칙을 공유한다.
//
// 정책: malformed 값은 import_issue(raw 보존)로 기록하고 운영 컬럼에는 parsed-valid만 채운다
// (잘못된 값은 운영 컬럼에 null/'' — 데이터 오염 금지). import는 차단이 아닌 가시화: 행은 적재하되
// 이슈를 남긴다. import_issue.issue_type enum = ip_format | missing_id | missing_os | dup_suspect.

export type IssueType = "ip_format" | "missing_id" | "missing_os" | "dup_suspect";

export interface RowIssue {
  issue_type: IssueType;
  raw_value: string;
  parsed_value: string;
  note: string;
}

export interface ParsedAsset {
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
  access_ips: string[];
  user_name: string;
  admin_name: string;
  network_zone: string;
  cia_c: number | null;
  cia_i: number | null;
  cia_a: number | null;
  purchase_date: string;
  warranty_date: string;
  eos_date: string;
  rack_unit_start: number | null;
  rack_unit_size: number;
  description: string;
}

export interface ValidatedRow {
  asset: ParsedAsset;
  issues: RowIssue[];
}

export const VALID_TYPES = ["server", "network", "security", "telecom", "vm", "other"] as const;
export const VALID_STATUSES = ["active", "maintenance", "standby", "retired"] as const;
// 한글 상태 라벨 → 저장 영문 enum (이관/업로드 원본이 한글일 때 정확 매핑; 영문은 그대로 통과)
const STATUS_LABEL_MAP: Record<string, string> = {
  "운용중": "active", "운영중": "active", "사용중": "active", "정상": "active",
  "점검중": "maintenance", "유지보수": "maintenance",
  "예비": "standby", "대기": "standby",
  "폐기": "retired", "불용": "retired", "반납": "retired",
};

const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 (ZIP/OOXML)
const XLSX_EMPTY_ARCHIVE = [0x50, 0x4b, 0x05, 0x06]; // empty zip
const XLS_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // legacy .xls (OLE2) — rejected (xlsx only)

/** 매직바이트 검증: 진짜 .xlsx(ZIP/OOXML)인지 확장자/Content-Type이 아닌 바이트로 판별. */
export function isXlsxBuffer(buf: Uint8Array): boolean {
  if (buf.length < 4) return false;
  const m = (sig: number[]) => sig.every((b, i) => buf[i] === b);
  return m(XLSX_MAGIC) || m(XLSX_EMPTY_ARCHIVE);
}
export function detectSpreadsheetKind(buf: Uint8Array): "xlsx" | "xls" | "unknown" {
  if (isXlsxBuffer(buf)) return "xlsx";
  if (buf.length >= 4 && XLS_MAGIC.every((b, i) => buf[i] === b)) return "xls";
  return "unknown";
}

// IPv4 (옵션 CIDR/마스크 허용 안 함 — 대표 IP는 순수 IPv4)
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export function isValidIpv4(ip: string): boolean {
  return IPV4.test(ip.trim());
}

function s(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}

/**
 * 한 행(raw 키-값)을 검증/파싱한다. 운영 컬럼에는 valid 값만; malformed는 issues로.
 * @param raw  컬럼키→원본문자열 (asset_type, asset_name, ip_address, os, cia_c ... )
 */
export function validateAssetRow(raw: Record<string, unknown>): ValidatedRow {
  const issues: RowIssue[] = [];

  // 유형: 표준 6종은 정규화(소문자), 그 외에는 독립 부서 자체 유형을 그대로 보존(ADR-011 확장).
  //   빈 값은 server 기본. 과거: enum 밖 값을 'other'로 강제했으나, 이젠 자유 입력이라 유지한다.
  let asset_type = s(raw.asset_type) || "server";
  const _typeLower = asset_type.toLowerCase();
  if ((VALID_TYPES as readonly string[]).includes(_typeLower)) asset_type = _typeLower;
  // 상태: 한글 라벨 우선 매핑(운용중→active 등) 후 영문 enum 검증, 미지원 값은 active로 안전 기본.
  const rawStatus = s(raw.status);
  let status = STATUS_LABEL_MAP[rawStatus] || rawStatus.toLowerCase() || "active";
  if (!(VALID_STATUSES as readonly string[]).includes(status)) status = "active";

  const asset_name = s(raw.asset_name);
  const serial_number = s(raw.serial_number);
  const asset_tag = s(raw.asset_tag);

  // 식별자 없음(missing_id)은 IP 파싱 후 판정한다(스펙 03_validation: IP·시리얼 모두 공란). access_ip 계산 뒤 아래에서 처리.

  // IP 형식 오류: 값이 있으나 IPv4가 아니면 ip_format, 운영 컬럼은 '' (오염 금지)
  const ipRaw = s(raw.ip_address);
  let ip_address = "";
  if (ipRaw) {
    if (isValidIpv4(ipRaw)) ip_address = ipRaw;
    else issues.push({ issue_type: "ip_format", raw_value: ipRaw, parsed_value: "", note: "IPv4 형식이 아닙니다." });
  }
  // 접근IP: 다중값 허용(| , 줄바꿈 구분). 유효 IPv4만 수집하고, 잘못된 토큰만 ip_format 이슈.
  // access_ip(단일 컬럼)에는 첫 유효 IP를, 나머지는 access_ips에 보존(이관 시 asset_ips로 적재).
  const accRaw = s(raw.access_ip);
  const access_ips: string[] = [];
  if (accRaw) {
    const tokens = accRaw.split(/[|,\r\n]+/).map((t) => t.trim()).filter(Boolean);
    for (const tok of tokens) {
      if (isValidIpv4(tok)) { if (!access_ips.includes(tok)) access_ips.push(tok); }
      else issues.push({ issue_type: "ip_format", raw_value: tok, parsed_value: "", note: "접근IP가 IPv4 형식이 아닙니다." });
    }
  }
  const access_ip = access_ips[0] || "";

  // 식별자 없음(AC-13/14): 유효 IP 없음 AND 시리얼번호 공란 → 자산 고유 식별 불가(예: 본원 층간스위치 외부망).
  if (!ip_address && !serial_number) {
    issues.push({
      issue_type: "missing_id",
      raw_value: JSON.stringify({ ip_address: ipRaw, serial_number, asset_tag }),
      parsed_value: "",
      note: "IP·시리얼번호가 모두 비어 자산을 고유 식별할 수 없습니다.",
    });
  }

  // OS 미입력: server/vm인데 os 비면 missing_os
  const os = s(raw.os);
  if ((asset_type === "server" || asset_type === "vm") && !os) {
    issues.push({ issue_type: "missing_os", raw_value: "", parsed_value: "", note: "서버/VM 자산에 OS가 비어 있습니다." });
  }

  // 망구분: 표준 2종(업무망/인터넷망) 동의어만 정규화하고, 그 외에는 독립 부서 자체 망 명칭을 그대로 보존(ADR-011 확장).
  const zoneRaw = s(raw.network_zone);
  let network_zone = zoneRaw;
  if (zoneRaw.includes("업무")) network_zone = "업무망";
  else if (zoneRaw.includes("인터넷") || zoneRaw === "외부" || /^dmz$/i.test(zoneRaw)) network_zone = "인터넷망";

  // CIA 1~3: 범위 밖이면 null(운영), 이슈로는 남기지 않음(등급은 보조 지표)
  const cia = (v: unknown): number | null => {
    const t = s(v);
    if (!t) return null;
    const n = Number(t);
    return Number.isInteger(n) && n >= 1 && n <= 3 ? n : null;
  };

  // 랙 유닛: 양의 정수만, 아니면 null/기본
  const startN = Number(s(raw.rack_unit_start));
  const rack_unit_start = Number.isInteger(startN) && startN >= 1 ? startN : null;
  const sizeN = Number(s(raw.rack_unit_size));
  const rack_unit_size = Number.isInteger(sizeN) && sizeN >= 1 ? sizeN : 1;

  const asset: ParsedAsset = {
    asset_type,
    asset_name,
    manufacturer: s(raw.manufacturer),
    model: s(raw.model),
    serial_number,
    ip_address,
    asset_tag,
    status,
    os,
    access_ip,
    access_ips,
    user_name: s(raw.user_name),
    admin_name: s(raw.admin_name),
    // ADR-009: department는 운영 적재하지 않음(읽기전용 레거시 음영) — team_id가 소유 권위
    network_zone,
    cia_c: cia(raw.cia_c),
    cia_i: cia(raw.cia_i),
    cia_a: cia(raw.cia_a),
    purchase_date: s(raw.purchase_date),
    warranty_date: s(raw.warranty_date),
    eos_date: s(raw.eos_date),
    rack_unit_start,
    rack_unit_size,
    description: s(raw.description),
  };

  return { asset, issues };
}

/**
 * 배치 적재 후 동명(asset_name 중복) 의심 그룹을 산출한다(dup_suspect).
 * @param rows  [{ id, asset_name }] (적재된 자산)
 * @returns 중복 의심 자산 id 목록 + 그룹 수
 */
export function detectDuplicates(
  rows: { id: number; asset_name: string; ip_address?: string; serial_number?: string }[],
): {
  suspectIds: number[];
  groupCount: number;
} {
  // 동명(asset_name) 그룹 내에서 IP/시리얼로 구분 가능한 자산은 별도 자산으로 보아 제외한다
  // (스펙 03_validation: "동일 이름이라도 IP가 다르면 별도 자산 — VDI 여러 대, 층간스위치 A/B 이중화").
  // 식별키(시리얼 우선, 없으면 IP)가 공란(구분 불가)이거나, 같은 식별키를 가진 멤버가 2건 이상(충돌)이면
  // 중복의심으로 본다. 그룹 내 고유 식별키를 가진 멤버는 정상 별도 자산으로 제외.
  const byName = new Map<string, { id: number; key: string }[]>();
  for (const r of rows) {
    const name = (r.asset_name || "").trim();
    if (!name) continue;
    const key = (r.serial_number || "").trim() || (r.ip_address || "").trim();
    const arr = byName.get(name) ?? [];
    arr.push({ id: r.id, key });
    byName.set(name, arr);
  }
  const suspectIds: number[] = [];
  let groupCount = 0;
  for (const members of byName.values()) {
    if (members.length <= 1) continue;
    const keyCount = new Map<string, number>();
    for (const m of members) if (m.key) keyCount.set(m.key, (keyCount.get(m.key) ?? 0) + 1);
    const groupSuspects = members
      .filter((m) => !m.key || (keyCount.get(m.key) ?? 0) > 1)
      .map((m) => m.id);
    if (groupSuspects.length > 0) {
      groupCount++;
      suspectIds.push(...groupSuspects);
    }
  }
  return { suspectIds, groupCount };
}

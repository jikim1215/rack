// ── 자산 등록/수정 본문 정규화 (순수 모듈) ──
// POST /api/assets 와 PUT /api/assets/[id] 가 같은 규칙으로 enum·정수·날짜·길이를 검증한다.
import { asBody, str, oneOf, int, idOrNull, dateStr } from "./input.ts";
import { VALID_STATUSES } from "./asset-rules.ts";
import { normalizeAccessIps } from "../access-ip.ts";

const IP_TYPES = ["management", "service", "backup", "vip", "other", "extra"] as const;

export type ParsedAssetBody = ReturnType<typeof parseAssetBody>;

type DateField = "purchase_date" | "warranty_date" | "eos_date";
const DATE_LABELS: Record<DateField, string> = { purchase_date: "구매일", warranty_date: "보증만료일", eos_date: "EoS" };

/**
 * POST/PUT 공통 본문 정규화 — enum·정수·날짜·길이를 검증하고 컴럼 값으로 만든다.
 * @param existing PUT 시 기존 행. 날짜 필드가 기존 저장값과 동일하면(사용자가 건드리지 않음) 형식 검사 없이 그대로 보존한다 —
 *   정규화되지 않은 레거시 날짜 때문에 다른 필드 편집까지 막히지 않게 (비평 반영).
 */
export function parseAssetBody(body: unknown, existing?: Partial<Record<DateField, string>>) {
  const b = asBody(body);
  const date = (key: DateField) => {
    const raw = b[key];
    if (existing && existing[key] !== undefined && String(raw ?? "") === existing[key]) return existing[key] as string;
    return dateStr(b, key, { label: DATE_LABELS[key] });
  };
  // asset_name: 구 클라이언트 호환으로 name 키도 허용
  if (b.asset_name === undefined && b.name !== undefined) b.asset_name = b.name;
  const rackId = idOrNull(b, "rack_id", "랙");
  const rackSideRaw = b.rack_side;
  // 반폭 배치(rack_side): 'L'/'R'만 인정, 그 외/미지정은 null(전폭). 랙 미설치면 null. (PUT/PATCH와 동일 규칙)
  const rackSide: "L" | "R" | null = rackId && (rackSideRaw === "L" || rackSideRaw === "R") ? rackSideRaw : null;
  const cia = (key: string) => int(b, key, { min: 1, max: 3, label: key.toUpperCase() });
  const ipsRaw = Array.isArray(b.ips) ? b.ips : [];
  const ips = ipsRaw.map((ip) => {
    const o = asBody(ip);
    return {
      ip_address: str(o, "ip_address", { max: 64 }),
      ip_type: oneOf(o, "ip_type", IP_TYPES, { default: "service", label: "IP 유형" }),
      interface_name: str(o, "interface_name", { max: 64 }),
      subnet_mask: str(o, "subnet_mask", { max: 64 }),
      gateway: str(o, "gateway", { max: 64 }),
      is_primary: o.is_primary ? 1 : 0,
      description: str(o, "description", { max: 500 }),
    };
  }).filter((ip) => ip.ip_address);
  const customValues = b.custom_values && typeof b.custom_values === "object" && !Array.isArray(b.custom_values)
    ? (b.custom_values as Record<string, unknown>) : null;
  return {
    columns: {
      asset_type: str(b, "asset_type", { required: true, max: 40, label: "자산 유형" }),
      asset_name: str(b, "asset_name", { required: true, max: 200, label: "자산명" }),
      manufacturer: str(b, "manufacturer", { max: 100 }),
      model: str(b, "model", { max: 100 }),
      serial_number: str(b, "serial_number", { max: 100 }),
      ip_address: str(b, "ip_address", { max: 64 }),
      asset_tag: str(b, "asset_tag", { max: 100 }),
      status: oneOf(b, "status", VALID_STATUSES, { default: "active", label: "상태" }),
      os: str(b, "os", { max: 100 }),
      access_ip: normalizeAccessIps(typeof b.access_ip === "string" ? b.access_ip : undefined),
      user_name: str(b, "user_name", { max: 100 }),
      admin_name: str(b, "admin_name", { max: 100 }),
      network_zone: str(b, "network_zone", { max: 40 }),
      cia_c: cia("cia_c"), cia_i: cia("cia_i"), cia_a: cia("cia_a"),
      purchase_date: date("purchase_date"),
      warranty_date: date("warranty_date"),
      eos_date: date("eos_date"),
      rack_id: rackId,
      rack_unit_start: rackId ? int(b, "rack_unit_start", { min: 1, max: 99, label: "시작 U" }) : null,
      rack_unit_size: int(b, "rack_unit_size", { min: 1, max: 48, default: 1, label: "U 크기" }) ?? 1,
      rack_side: rackSide,
      description: str(b, "description", { max: 4000 }),
    },
    ips,
    /** 본문에 ips 배열이 있었는지(빈 배열 포함) — PUT 에서 "전체 교체" vs "유지" 분기 */
    ipsProvided: Array.isArray(b.ips),
    customValues,
    teamIdRaw: b.team_id,
  };
}


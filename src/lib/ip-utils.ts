import type Database from "better-sqlite3";

/**
 * 공인 IPv4 판정 유틸.
 *
 * 정책: 폐쇄망 내부에서는 VIP/이중화(HA) 공유 등으로 사설 IP를 여러 자산이
 * 공유하는 패턴이 정상 운영이므로 사설 IP 중복은 허용한다.
 * 공인 IP만 자산 간 중복을 차단한다.
 */

/**
 * 주어진 문자열이 "공인" IPv4 주소인지 판정한다.
 * - IPv4 형식이 아니면 false
 * - 사설(10/8, 172.16/12, 192.168/16), 루프백(127/8), 링크로컬(169.254/16),
 *   멀티캐스트(224/4), 예약(0/8, 240/4) 대역이면 false
 * - 그 외에는 true (공인 IP)
 */
export function isPublicIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return false;
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (octets.some((o) => o > 255)) return false;
  const [a, b] = octets;

  if (a === 10) return false; // 사설 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return false; // 사설 172.16.0.0/12
  if (a === 192 && b === 168) return false; // 사설 192.168.0.0/16
  if (a === 127) return false; // 루프백 127.0.0.0/8
  if (a === 169 && b === 254) return false; // 링크로컬 169.254.0.0/16
  if (a >= 224 && a <= 239) return false; // 멀티캐스트 224.0.0.0/4
  if (a === 0) return false; // 예약 0.0.0.0/8
  if (a >= 240) return false; // 예약 240.0.0.0/4

  return true;
}

/**
 * 등록/수정하려는 IP 목록 중 "공인 IP"가 다른 자산에서 이미 사용 중인지 검사한다.
 * assets.ip_address(대표 IP)와 asset_ips.ip_address(다중 IP) 양쪽을 모두 조회한다.
 *
 * - 빈 문자열/공백/비공인(사설 등) IP는 검사 대상에서 제외 (사설 중복 허용 정책)
 * - excludeAssetId 지정 시 해당 자산 자신은 제외 (PUT 재저장 허용)
 *
 * @returns 중복 발견 시 { ip, assetId, assetName }, 없으면 null
 */
export function findPublicIpDuplicate(
  db: Database.Database,
  ips: string[],
  excludeAssetId?: number
): { ip: string; assetId: number; assetName: string } | null {
  // 공인 IP만 추려서 검사 (중복 입력 제거)
  const publicIps = [...new Set(ips.map((ip) => (ip || "").trim()).filter((ip) => ip !== "" && isPublicIpv4(ip)))];
  if (publicIps.length === 0) return null;

  const findByPrimary = db.prepare(
    "SELECT id, asset_name FROM assets WHERE ip_address = ? AND id != ? LIMIT 1"
  );
  const findByExtra = db.prepare(`
    SELECT ai.asset_id AS id, a.asset_name
    FROM asset_ips ai JOIN assets a ON a.id = ai.asset_id
    WHERE ai.ip_address = ? AND ai.asset_id != ? LIMIT 1
  `);
  const exclude = excludeAssetId ?? -1;

  for (const ip of publicIps) {
    const hit = (findByPrimary.get(ip, exclude) ?? findByExtra.get(ip, exclude)) as
      | { id: number; asset_name: string }
      | undefined;
    if (hit) {
      return { ip, assetId: hit.id, assetName: hit.asset_name ?? "" };
    }
  }
  return null;
}

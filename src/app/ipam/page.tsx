export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { scopeWhere, actorFromSession, locationScopeWhere } from "@/lib/authz";
import { getSession } from "@/lib/auth";
import { IpamView } from "./IpamView";
import { splitAccessIps } from "@/lib/access-ip";

export default async function IpamPage() {
  const db = getDb();
  const actor = actorFromSession(await getSession());

  // 서브넷(IP대역)은 소유 전용(team_id): 팀은 자기 팀 대역만. 총괄/전체열람은 전체.
  const subnetScope = scopeWhere(actor, "s.team_id");
  const subnets = db.prepare(
    `SELECT s.*, l.location_name, t.team_name AS owner_team_name FROM ip_subnets s
     LEFT JOIN locations l ON s.location_id = l.id
     LEFT JOIN teams t ON s.team_id = t.id
     WHERE ${subnetScope.sql}
     ORDER BY s.network_address`
  ).all(...subnetScope.params) as any[];

  // IP 사용 현황 = 정보자산에 기입된 모든 IP를 연계: 다중IP(asset_ips) + 대표IP(assets.ip_address) + 접근IP(assets.access_ip).
  // asset_ips + 대표는 UNION으로, 접근IP는 다중값이라 아래에서 자산별로 분리 전개해 합친다.
  // 팀 사용자는 자기 팀 자산 IP만(스코프는 통합 결과 x.team_id에 적용; 미귀속 team_id NULL은 team 숨김/admin·viewer 노출).
  const scope = scopeWhere(actor, "x.team_id");
  const assetIps = db.prepare(
    `SELECT x.id, x.asset_id, x.ip_address, x.ip_type, x.interface_name, x.asset_name
     FROM (
       SELECT ai.id AS id, ai.asset_id AS asset_id, ai.ip_address AS ip_address,
              ai.ip_type AS ip_type, ai.interface_name AS interface_name,
              a.asset_name AS asset_name, a.team_id AS team_id
         FROM asset_ips ai LEFT JOIN assets a ON ai.asset_id = a.id
        WHERE (a.status IS NULL OR a.status <> 'retired')
       UNION ALL
       SELECT -a.id, a.id, a.ip_address, '대표', '', a.asset_name, a.team_id
         FROM assets a WHERE a.ip_address <> '' AND a.status <> 'retired'
     ) x
     WHERE ${scope.sql}`
  ).all(...scope.params) as any[];

  // 접근 IP는 다중값(", " 조인)일 수 있으므로 자산별로 분리해 각 IP를 개별 '접근' 항목으로 전개한다
  // (단일 컬럼을 그대로 UNION하면 "a, b"가 한 칸에 뭉쳐 IPAM 격자에서 오탐/누락됨).
  const accScope = scopeWhere(actor, "a.team_id");
  const accessRows = db.prepare(
    `SELECT a.id AS asset_id, a.access_ip AS access_ip, a.asset_name AS asset_name
       FROM assets a WHERE a.access_ip <> '' AND a.status <> 'retired' AND ${accScope.sql}`
  ).all(...accScope.params) as any[];
  for (const r of accessRows) {
    splitAccessIps(r.access_ip).forEach((ip: string, idx: number) => {
      assetIps.push({
        id: -1000000 - r.asset_id * 100 - idx,
        asset_id: r.asset_id,
        ip_address: ip,
        ip_type: "접근",
        interface_name: "",
        asset_name: r.asset_name,
      });
    });
  }

  // 위치 드롭다운: 내게 보이는 위치만(하이브리드). 총괄/전체열람은 전체.
  const locScope = locationScopeWhere(actor, "l.team_id", "l.id");
  const locations = db.prepare(
    `SELECT l.* FROM locations l WHERE ${locScope.sql} ORDER BY l.sort_order, l.location_name`
  ).all(...locScope.params) as any[];

  const teams = actor?.role === "admin" ? (db.prepare("SELECT id, team_name FROM teams ORDER BY team_name").all() as any[]) : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="eyebrow">IPAM</div>
          <h2 className="text-2xl font-bold tracking-tight">IP관리</h2>
        </div>
      </div>
      <IpamView subnets={subnets} assetIps={assetIps} locations={locations} canWrite={!!actor && actor.role !== "viewer"} teams={teams} isAdmin={actor?.role === "admin"} />
    </div>
  );
}

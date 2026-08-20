export const dynamic = "force-dynamic";
import { getDb } from "@/lib/db";
import { scopeWhere, actorFromSession } from "@/lib/authz";
import { getSession } from "@/lib/auth";
import SubAssetsView from "./SubAssetsView";

// 부속자산 — S/W·기반설비·메모리·모듈·디스크·주변기기·비품 등 재물 관점 품목.
// 자산(assets)과 동일한 팀 스코프 정책으로 SSR 목록 + 분류 집계를 전달한다.
export default async function SubAssetsPage() {
  const db = getDb();
  const actor = actorFromSession(await getSession());
  const scope = scopeWhere(actor, "s.team_id");

  const rows = db.prepare(`
    SELECT s.*, a.asset_name AS parent_name
    FROM sub_assets s
    LEFT JOIN assets a ON s.parent_asset_id = a.id
    WHERE ${scope.sql}
    ORDER BY s.asset_code, s.id
  `).all(...scope.params) as any[];

  // 분류 집계(중분류>소분류 건수) — 필터 셀렉트 옵션 + KPI 상위 분류 근거
  const categories = db.prepare(`
    SELECT s.category_mid, s.category_minor, COUNT(*) AS cnt
    FROM sub_assets s
    WHERE ${scope.sql}
    GROUP BY s.category_mid, s.category_minor
    ORDER BY cnt DESC
  `).all(...scope.params) as any[];

  // 쓰기 버튼 노출 조건 — viewer 제외, 팀 미배정 team 계정 제외 (서버 assertCanWrite 와 동일 정책)
  const canWrite =
    actor?.role === "admin" || (actor?.role === "team" && actor.teamId != null);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="eyebrow">SUB ASSETS</p>
          <h2 className="text-2xl font-bold tracking-tight">부속자산</h2>
        </div>
      </div>
      <SubAssetsView initialRows={rows} categories={categories} canWrite={canWrite} />
    </div>
  );
}

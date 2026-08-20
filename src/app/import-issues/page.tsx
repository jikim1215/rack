export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ImportIssuesView } from "./ImportIssuesView";

// 정리큐 처리 화면 — 총괄(admin) 전용 (대시보드 정리 필요 큐에서 진입)
export default async function ImportIssuesPage() {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/");
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <span className="eyebrow">CLEANUP QUEUE</span>
          <h2 className="text-2xl font-bold tracking-tight">정리큐 처리</h2>
          <p className="text-sm text-ink-3 mt-1">엑셀 가져오기에서 분리 수집된 이상값을 확인하고 처리 상태를 관리합니다. 값 자체의 정정은 자산관리에서 수행합니다.</p>
        </div>
      </div>
      <ImportIssuesView />
    </div>
  );
}

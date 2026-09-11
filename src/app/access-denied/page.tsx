export const dynamic = "force-dynamic";
import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { menuByKey } from "@/lib/menus";

// 메뉴 접근 권한이 없는 사용자가 URL 로 직접 진입했을 때 (requireMenuPage 가 리다이렉트).
export default async function AccessDeniedPage({ searchParams }: { searchParams: Promise<{ menu?: string }> }) {
  const { menu } = await searchParams;
  const label = (menu && menuByKey(menu)?.label) || "요청한";
  return (
    <div className="max-w-lg mx-auto mt-16 panel p-8 text-center">
      <ShieldOff size={36} className="mx-auto text-ink-3" />
      <span className="eyebrow block mt-4">ACCESS DENIED</span>
      <h2 className="text-xl font-bold mt-1">&lsquo;{label}&rsquo; 메뉴 접근 권한이 없습니다</h2>
      <p className="text-sm text-ink-2 mt-3">
        현재 역할에는 이 메뉴가 열려 있지 않습니다. 업무상 필요하면 총괄(관리자)에게 <strong>설정 → 메뉴 권한</strong>에서 접근을 열어 달라고 요청하세요.
      </p>
      <Link href="/" className="btn-ink inline-flex mt-6">대시보드로</Link>
    </div>
  );
}

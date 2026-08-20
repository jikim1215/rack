export const dynamic = "force-dynamic";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LogViewer } from "./LogViewer";

// 로그/감사 총괄 조회 (G010 / AC-1·19·20) — 총괄(admin) 전용.
// 접속기록(access_logs) + 감사로그(audit_logs)를 조회한다. API는 admin 전용으로 게이트된다.
export default async function LogsPage() {
  const session = await getSession();
  if (session?.role !== "admin") {
    redirect("/");
  }
  return <LogViewer />;
}

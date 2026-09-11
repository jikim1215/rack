// nonce 기반 CSP(middleware)는 요청마다 다른 nonce 를 하이드레이션 스크립트에 붙여야 하므로 정적 프리렌더 불가 — 동적 렌더 고정.
export const dynamic = "force-dynamic";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-rail px-4">
      <div className="w-full max-w-sm">
        <div className="panel overflow-hidden">
          {/* 장비 전면 패널 헤더 */}
          <div className="panel-head bg-surface">
            <span className="led led-up led-live" />
            <span className="eyebrow">SYSTEM ONLINE · LOGIN</span>
          </div>
          <div className="p-8">
            <h1 className="text-xl font-bold tracking-tight text-ink">정보시스템 자산관리</h1>
            <p className="text-sm text-ink-2 mt-1 mb-6">계정으로 콘솔에 접속하세요.</p>
            <Suspense fallback={<div className="text-center text-ink-3 text-sm">로딩중...</div>}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
        <p className="text-center eyebrow mt-4 text-slate-500" style={{ textTransform: "none" }}>접속 계정이 필요하면 <span className="text-slate-400 font-medium">운영팀</span>에 문의하세요.</p>
      </div>
    </div>
  );
}

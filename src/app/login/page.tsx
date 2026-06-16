import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-slate-900">🖥️ 자산관리</h1>
            <p className="text-sm text-slate-500 mt-1">정보시스템 자산관리 솔루션</p>
          </div>
          <Suspense fallback={<div className="text-center text-slate-400 text-sm">로딩중...</div>}>
            <LoginForm />
          </Suspense>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">
          초기 계정: admin / admin123
        </p>
      </div>
    </div>
  );
}

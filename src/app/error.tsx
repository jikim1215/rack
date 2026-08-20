"use client";

// 라우트 세그먼트 에러 바운더리 — 렌더 중 예기치 못한 오류가 앱 전체를 무너뜨리지 않게 한다.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="panel p-8 max-w-md w-full text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <span className="led led-fault" />
          <span className="eyebrow">SYSTEM FAULT</span>
        </div>
        <h2 className="text-lg font-bold tracking-tight mb-2">
          화면을 표시하는 중 오류가 발생했습니다
        </h2>
        <p className="text-sm text-ink-2 mb-6">
          일시적인 문제일 수 있습니다. 다시 시도해 주세요.
          {error?.digest ? ` (오류 코드: ${error.digest})` : ""}
        </p>
        <button onClick={() => reset()} className="btn-ink">
          다시 시도
        </button>
      </div>
    </div>
  );
}

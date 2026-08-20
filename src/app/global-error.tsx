"use client";

// 루트 레이아웃까지 무너진 경우의 최후 방어선.
// global-error는 루트 레이아웃(globals.css 포함)을 대체하므로 인라인 스타일로 프로젝트 톤을 재현한다.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f4f6fb",
          color: "#0b1220",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Malgun Gothic", "맑은 고딕", system-ui, sans-serif',
        }}
      >
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #dce3ee",
            borderRadius: "0.625rem",
            padding: "2rem",
            maxWidth: "28rem",
            width: "100%",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "ui-monospace, Consolas, monospace",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              fontSize: "0.6875rem",
              fontWeight: 600,
              color: "#8b97a8",
              marginBottom: "0.75rem",
            }}
          >
            SYSTEM FAULT
          </div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
            시스템 오류가 발생했습니다
          </h2>
          <p style={{ fontSize: "0.875rem", color: "#475569", margin: "0 0 1.5rem" }}>
            일시적인 문제일 수 있습니다. 다시 시도해 주세요.
            {error?.digest ? ` (오류 코드: ${error.digest})` : ""}
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: "#0b1220",
              color: "#fff",
              padding: "0.625rem 1rem",
              borderRadius: "0.5rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}

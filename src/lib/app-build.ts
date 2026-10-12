// 빌드 때 박힌 버전·커밋·빌드 시각 — 서버 전용(라우트 핸들러·서버 컴포넌트에서만 import).
// next.config.ts 의 env 는 import 한 번들에 상수로 치환되므로, 클라이언트 컴포넌트가 이걸 import 하면
// 커밋·빌드 시각이 무인증으로 받는 /_next/static JS 청크에 박힌다(정찰 정보 노출).
// 화면 표기는 로그인 후 /api/auth/me 의 build 로 받는다. 가드: tests/app-version.test.ts.
import type { AppBuild } from "./app-version";

export const APP_BUILD: AppBuild = {
  version: process.env.APP_VERSION ?? "",
  commit: process.env.APP_COMMIT ?? "",
  builtAt: process.env.APP_BUILT_AT ?? "",
};

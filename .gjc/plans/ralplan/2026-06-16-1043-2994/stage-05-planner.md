## Phase 1: 로그인/사용자 인증

1.1 DB users 테이블 - src/lib/db.ts에 initSchema 추가: id, username UNIQUE, password_hash, display_name, role CHECK(admin/user/viewer), must_change_pw INTEGER, created_at
1.2 인증 라이브러리 - 생성 src/lib/auth.ts: hashPassword(scryptSync+salt), verifyPassword(timingSafeEqual), createSession(userId.username.role.expiry|hmac-sha256), verifySession(HMAC+expiry, DB불필요=Edge호환), getSessionFromCookies, SESSION_COOKIE=rack_session, TTL=24h, AUTH_SECRET=env
1.3 API - 생성 src/app/api/auth/login/route.ts(POST: DB조회+verify+Set-Cookie httpOnly), logout/route.ts(POST: 쿠키삭제), me/route.ts(GET: 세션정보)
1.4 Middleware - 생성 src/middleware.ts: matcher /((?!login|api/auth|_next/static|_next/image|favicon.ico).*), HMAC검증만, redirect /login
1.5 로그인UI - 생성 src/app/login/layout.tsx(Sidebar없음), page.tsx(SC), LoginForm.tsx(CC: POST->router.push)
1.6 Sidebar - 변경 src/components/Sidebar.tsx: useEffect /api/auth/me, 사용자명+역할배지+LogOut버튼
1.7 시드 - scripts/db-seed.mjs: admin/admin123(must_change_pw=1), user/user123, viewer/viewer123. .env: AUTH_SECRET 추가
검증: build, redirect, login, Sidebar user, logout

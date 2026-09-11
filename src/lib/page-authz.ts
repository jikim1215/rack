// 서버 컴포넌트(page.tsx)용 메뉴 접근 게이트. API 는 api-authz.ts 의 getActor + assertMenu* 가 담당한다.
// 과거엔 사이드바에서만 메뉴를 숨겨 URL 직접 입력으로 우회가 가능했다(P1). 이제 페이지도 서버에서 거부한다.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadMenuPerms } from "@/lib/api-authz";
import { actorFromSession, menuPermission, type Actor } from "@/lib/authz";
import { menuByKey } from "@/lib/menus";

/**
 * 메뉴 접근 권한이 있는 인가 주체를 돌려준다. 미인증이면 로그인으로, 권한 없으면 /access-denied 로 리다이렉트.
 * 반환된 actor 는 perms 를 포함하므로 페이지가 쓰기 가능 여부(menuPermission(actor, key).write)를 UI 힌트로 쓸 수 있다.
 */
export async function requireMenuPage(menuKey: string): Promise<Actor> {
  const session = await getSession();
  const href = menuByKey(menuKey)?.href ?? "/";
  if (!session) redirect(`/login?redirect=${encodeURIComponent(href)}`);
  const actor = actorFromSession(session, session.role === "admin" ? {} : loadMenuPerms(session.role));
  if (!actor) redirect(`/login?redirect=${encodeURIComponent(href)}`);
  if (!menuPermission(actor, menuKey).access) redirect(`/access-denied?menu=${encodeURIComponent(menuKey)}`);
  return actor;
}

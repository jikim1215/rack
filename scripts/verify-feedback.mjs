// ── 개선의견(feedback) E2E 검증 ──
// 실행 중인 서버에 admin/team/viewer 로 로그인해 접수·공감·처리·잠금·삭제 정책과 SSR 을 검증한다.
// 사용: 서버 기동 후  node scripts/verify-feedback.mjs   (BASE_URL 로 대상 오버라이드)
import { createHash } from "crypto";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const sha512 = (s) => createHash("sha512").update(s).digest("hex");
let failures = 0;
const ok = (n) => console.log(`  ✓ ${n}`);
const fail = (n, d) => { failures++; console.error(`  ✗ ${n} — ${d}`); };
const assert = (c, n, d = "") => (c ? ok(n) : fail(n, d));

async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: sha512(password) }),
  });
  if (!r.ok) throw new Error(`login ${username} → ${r.status}`);
  return { Cookie: (r.headers.get("set-cookie") || "").split(";")[0], "Content-Type": "application/json" };
}
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

async function main() {
  console.log(`── verify-feedback: ${BASE} ──`);
  const admin = await login("admin@example.go.kr", "admin123");
  const team = await login("user@example.go.kr", "user123");
  const viewer = await login("viewer@example.go.kr", "viewer123");
  ok("3역할 로그인");

  // 미인증 → 401
  assert((await fetch(`${BASE}/api/feedback`)).status === 401, "미인증 목록 401");

  // viewer 접수 (열람 전용 계정도 의견은 낼 수 있어야 한다)
  let r = await j(await fetch(`${BASE}/api/feedback`, { method: "POST", headers: viewer, body: JSON.stringify({ category: "inconvenience", title: "E2E 뷰어 의견", content: "검색창이 너무 작아요", page_path: "/assets?q=x" }) }));
  assert(r.status === 201 && r.body.id > 0 && r.body.created_by === "viewer@example.go.kr", "viewer 접수 201", JSON.stringify(r));
  const viewerFb = r.body.id;

  // team 접수 + 검증 실패
  r = await j(await fetch(`${BASE}/api/feedback`, { method: "POST", headers: team, body: JSON.stringify({ category: "bug", title: "E2E 팀 의견", content: "엑셀 업로드 실패 행 표시 안 됨", page_path: "https://evil.example" }) }));
  assert(r.status === 201 && r.body.page_path === "", "team 접수 201 + 외부 URL page_path 제거", JSON.stringify(r.body));
  const teamFb = r.body.id;
  r = await j(await fetch(`${BASE}/api/feedback`, { method: "POST", headers: team, body: JSON.stringify({ title: "", content: "x" }) }));
  assert(r.status === 400, "빈 제목 400", `status ${r.status}`);
  r = await j(await fetch(`${BASE}/api/feedback`, { method: "POST", headers: team, body: JSON.stringify({ category: "zzz", title: "t", content: "c" }) }));
  assert(r.status === 400, "잘못된 유형 400", `status ${r.status}`);

  // 공감: 본인 글 403, 타인 글 토글
  r = await j(await fetch(`${BASE}/api/feedback/${teamFb}/vote`, { method: "POST", headers: team }));
  assert(r.status === 403, "본인 글 공감 403", `status ${r.status}`);
  r = await j(await fetch(`${BASE}/api/feedback/${teamFb}/vote`, { method: "POST", headers: viewer }));
  assert(r.status === 200 && r.body.voted === true && r.body.votes === 1, "타인 공감 +1", JSON.stringify(r.body));
  r = await j(await fetch(`${BASE}/api/feedback/${teamFb}/vote`, { method: "POST", headers: admin }));
  assert(r.status === 200 && r.body.votes === 2, "총괄 공감 +1 → 2", JSON.stringify(r.body));
  r = await j(await fetch(`${BASE}/api/feedback/${teamFb}/vote`, { method: "POST", headers: viewer }));
  assert(r.status === 200 && r.body.voted === false && r.body.votes === 1, "재호출 시 공감 취소 → 1", JSON.stringify(r.body));

  // 목록: 공감순 정렬 + voted 플래그 + mine 필터 + 집계
  r = await j(await fetch(`${BASE}/api/feedback?sort=votes&status=active`, { headers: admin }));
  assert(r.status === 200 && r.body.rows[0]?.id === teamFb && r.body.rows[0].voted === 1, "공감순 첫 행 = 팀 의견, 총괄 voted=1", JSON.stringify(r.body.rows?.[0]));
  assert(r.body.byStatus.open >= 2, "byStatus.open 집계", JSON.stringify(r.body.byStatus));
  r = await j(await fetch(`${BASE}/api/feedback?mine=1`, { headers: viewer }));
  assert(r.body.rows.every((x) => x.created_by === "viewer@example.go.kr") && r.body.rows.some((x) => x.id === viewerFb), "mine=1 은 본인 글만", "");
  r = await j(await fetch(`${BASE}/api/feedback?summary=1`, { headers: admin }));
  assert(r.status === 200 && r.body.byStatus && r.body.rows === undefined, "summary=1 은 집계만", JSON.stringify(r.body));

  // 처리(모더레이션): 비총괄 403, 총괄 OK, 답변 시각 기록
  r = await j(await fetch(`${BASE}/api/feedback/${teamFb}`, { method: "PATCH", headers: team, body: JSON.stringify({ status: "done" }) }));
  assert(r.status === 403, "team 상태 변경 403", `status ${r.status}`);
  r = await j(await fetch(`${BASE}/api/feedback/${teamFb}`, { method: "PATCH", headers: admin, body: JSON.stringify({ status: "in_review", priority: "high", admin_reply: "다음 배포에 반영" }) }));
  assert(r.status === 200 && r.body.status === "in_review" && r.body.priority === "high" && r.body.replied_by === "admin@example.go.kr" && r.body.replied_at, "총괄 처리 반영 + 답변자/시각", JSON.stringify(r.body));
  const repliedAt = r.body.replied_at;
  r = await j(await fetch(`${BASE}/api/feedback/${teamFb}`, { method: "PATCH", headers: admin, body: JSON.stringify({ status: "planned" }) }));
  assert(r.body.replied_at === repliedAt && r.body.admin_reply === "다음 배포에 반영", "상태만 변경 시 답변/시각 보존", JSON.stringify(r.body));
  r = await j(await fetch(`${BASE}/api/feedback/${teamFb}`, { method: "PATCH", headers: admin, body: JSON.stringify({ status: "nope" }) }));
  assert(r.status === 400, "잘못된 상태 400", `status ${r.status}`);

  // 작성자 수정 잠금: 검토 시작(in_review 이상) 후 작성자 수정/삭제 403, 접수 상태면 OK
  r = await j(await fetch(`${BASE}/api/feedback/${teamFb}`, { method: "PATCH", headers: team, body: JSON.stringify({ category: "bug", title: "수정 시도", content: "c" }) }));
  assert(r.status === 403, "검토 시작 후 작성자 수정 403", `status ${r.status}`);
  r = await j(await fetch(`${BASE}/api/feedback/${teamFb}`, { method: "DELETE", headers: team }));
  assert(r.status === 403, "검토 시작 후 작성자 삭제 403", `status ${r.status}`);
  r = await j(await fetch(`${BASE}/api/feedback/${viewerFb}`, { method: "PATCH", headers: viewer, body: JSON.stringify({ category: "improvement", title: "E2E 뷰어 의견(수정)", content: "검색창 넓혀주세요", page_path: "/assets" }) }));
  assert(r.status === 200 && r.body.title === "E2E 뷰어 의견(수정)" && r.body.category === "improvement", "접수 상태 본인 글 수정 OK", JSON.stringify(r.body));
  r = await j(await fetch(`${BASE}/api/feedback/${viewerFb}`, { method: "PATCH", headers: team, body: JSON.stringify({ title: "남의 글", content: "c" }) }));
  assert(r.status === 403, "타인 글 수정 403", `status ${r.status}`);
  r = await j(await fetch(`${BASE}/api/feedback/${viewerFb}`, { method: "DELETE", headers: team }));
  assert(r.status === 403, "타인 글 삭제 403", `status ${r.status}`);

  // SSR: /feedback 페이지 + 사이드바 진입점
  const html = await (await fetch(`${BASE}/feedback`, { headers: team })).text();
  assert(html.includes("개선의견 · 불편사항"), "/feedback SSR 타이틀", "");
  assert(html.includes("불편사항 · 개선의견 보내기"), "사이드바 '의견 보내기' 버튼", "");
  const anon = await fetch(`${BASE}/feedback`, { redirect: "manual" });
  assert(anon.status === 307 || anon.status === 302, "미인증 /feedback 은 로그인 리다이렉트", `status ${anon.status}`);

  // 정리: 작성자(접수 상태) 삭제 + 총괄 삭제
  r = await j(await fetch(`${BASE}/api/feedback/${viewerFb}`, { method: "DELETE", headers: viewer }));
  assert(r.status === 200, "접수 상태 본인 글 삭제 OK", `status ${r.status}`);
  r = await j(await fetch(`${BASE}/api/feedback/${teamFb}`, { method: "DELETE", headers: admin }));
  assert(r.status === 200, "총괄은 검토중 글도 삭제 가능", `status ${r.status}`);
  r = await j(await fetch(`${BASE}/api/feedback/${teamFb}`, { method: "DELETE", headers: admin }));
  assert(r.status === 404, "삭제된 글 404", `status ${r.status}`);

  console.log(failures === 0 ? "── PASS ──" : `── FAIL (${failures}) ──`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

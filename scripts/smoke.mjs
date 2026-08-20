// ── 스모크 테스트 (가드레일) ──
// 목적: "화면에 데이터가 조용히 사라지는" 회귀(예: 자산관리 IP 미표시)를 기계적으로 감지한다.
// 실행 중인 서버에 로그인해 핵심 화면의 SSR HTML과 API 불변식을 검증한다.
// 사용: 서버 기동 후  node scripts/smoke.mjs  (또는 npm run smoke)
//       BASE_URL, SMOKE_USER, SMOKE_PASS 환경변수로 대상/계정 오버라이드.
// 배포 체크: docs/DEPLOY.md의 배포 후 확인 절차에 포함.
import { createHash } from "crypto";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const USER = process.env.SMOKE_USER || "admin@example.go.kr";
const PASS = process.env.SMOKE_PASS || "admin123";
const sha512 = (s) => createHash("sha512").update(s).digest("hex");

let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const fail = (name, detail) => { failures++; console.error(`  ✗ ${name} — ${detail}`); };
const assert = (cond, name, detail = "") => (cond ? ok(name) : fail(name, detail));

async function main() {
  console.log(`── smoke: ${BASE} ──`);

  // 0) 로그인 (클라이언트 SHA-512 프리해시 규약 — LoginForm과 동일)
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: sha512(PASS) }),
  });
  if (!lr.ok) { fail("로그인", `status ${lr.status}`); process.exit(1); }
  const cookie = (lr.headers.get("set-cookie") || "").split(";")[0];
  const H = { Cookie: cookie };
  ok("로그인");

  // 1) 자산 API 불변식: '데이터 증발' 클래스 감지용 저감도 하한 — 배포처 규모에 맞게 SMOKE_MIN_* 로 조정 (비평 합의 R4-1)
  const MIN = Number(process.env.SMOKE_MIN_ASSETS || 100);
  const assets = await (await fetch(`${BASE}/api/assets`, { headers: H })).json();
  assert(Array.isArray(assets) && assets.length >= MIN, `자산 API 응답/규모(>=${MIN})`, `len=${assets?.length}`);
  const withIp = assets.filter((a) => a.ip_address && a.ip_address.trim() !== "");
  assert(withIp.length >= MIN, `IP 보유 자산 하한(>=${MIN})`, `현재 ${withIp.length}대 — 급감 시 임포트/쿼리 회귀 의심`);
  assert(assets.some((a) => a.serial_number), "시리얼 보유 자산 존재", "");
  assert(assets.some((a) => a.rack_id != null), "실장 자산 존재", "");

  // 2) 자산관리 SSR: 실제 IP 문자열이 화면 HTML에 렌더되는가 — 표본 3개 any-pass (단일 표본 정렬 취약, 비평 합의 R4-2)
  const samples = withIp.slice(0, 3);
  let rendered = false;
  for (const s of samples) {
    const html = await (await fetch(`${BASE}/assets?q=${encodeURIComponent(s.asset_name)}`, { headers: H })).text();
    if (html.includes(s.ip_address)) { rendered = true; break; }
  }
  assert(rendered, "자산관리 화면에 IP 렌더(표본 3)", `표본 ${samples.map((s) => s.ip_address).join(",")} 전부 미검출`);

  // 3) 랙 실장도: 랙과 실장 블록 존재
  const racksHtml = await (await fetch(`${BASE}/racks`, { headers: H })).text();
  assert(racksHtml.includes("랙 실장도"), "실장도 페이지", "");
  assert(racksHtml.includes("미배치 자산"), "미배치 패널", "");

  // 4) 배선(선번장): 프레임 존재 + 추적 API
  const frames = await (await fetch(`${BASE}/api/frames`, { headers: H })).json();
  assert(Array.isArray(frames) && frames.length >= 1, "배선반 존재", `len=${frames?.length}`);
  const trace = await fetch(`${BASE}/api/frames/trace?q=test`, { headers: H });
  assert(trace.ok, "선번 추적 API", `status ${trace.status}`);

  // 5) 대시보드: 라이프사이클/정리 큐 마커
  const dashHtml = await (await fetch(`${BASE}/`, { headers: H })).text();
  assert(dashHtml.includes("생명주기 흐름"), "대시보드 생명주기 패널", "");

  // 6) 자산실사: 페이지 + 회차 API
  const inspHtml = await (await fetch(`${BASE}/inspection`, { headers: H })).text();
  assert(inspHtml.includes("자산실사"), "자산실사 페이지", "");
  const audits = await fetch(`${BASE}/api/inventory-audits`, { headers: H });
  const auditsBody = audits.ok ? await audits.json() : null;
  assert(audits.ok && Array.isArray(auditsBody) && (auditsBody.length === 0 || ("audit_name" in auditsBody[0] && "total_assets" in auditsBody[0])),
    "자산실사 API(스키마 키 포함)", `status ${audits.status}`);

  // 6-1) 부속자산: 페이지 + 목록 규모 (재물 대장 유래 데이터 소실 감지)
  const subHtml = await (await fetch(`${BASE}/subassets`, { headers: H })).text();
  assert(subHtml.includes("부속자산"), "부속자산 페이지", "");
  const subs = await (await fetch(`${BASE}/api/sub-assets`, { headers: H })).json();
  assert(Array.isArray(subs) && subs.length >= 100, "부속자산 목록 하한(>=100)", `len=${subs?.length}`);

  // 7) 권한 불변식: 비로그인 API는 401
  const anon = await fetch(`${BASE}/api/assets`);
  assert(anon.status === 401, "비로그인 401", `status ${anon.status}`);

  console.log(failures === 0 ? "\n✅ smoke PASS" : `\n❌ smoke FAIL — ${failures}건`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("smoke 실행 실패:", e.message); process.exit(1); });

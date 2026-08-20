"use client";

// 첫 사용자 온보딩 — 스포트라이트 가이드 투어.
//  - 각 메뉴마다 2단계: ① 좌측 메뉴 하이라이트+설명 → ② 해당 페이지로 이동해 중앙 화면 하이라이트+설명.
//  - 특정 대상에 집중(주변 딤 + 하이라이트 링), 설명 툴팁, "직접 클릭해 열어보기" 유도.
//  - 최초 1회 자동 시작(localStorage 완료표시), 좌측 하단 '도움말' 버튼으로 재실행.
//  - 사이드바/메인은 앱 전역(LayoutShell)에 상주 → 페이지 이동 중에도 투어 유지.
//    (전체 새로고침 대비 sessionStorage 로 현재 단계 보존)
import { useEffect, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, X, Sparkles, Check, MousePointerClick, MonitorPlay } from "lucide-react";

const DONE_KEY = "asset_onboarding_done_v1";   // localStorage: 완료(자동시작 억제)
const RUN_KEY = "asset_onboarding_run_v1";     // sessionStorage: 진행 중 현재 단계

type Step = {
  selector?: string;    // 대상 요소(없으면 중앙 카드)
  title: string;
  desc: string;
  clickable?: boolean;  // 메뉴 단계: 실제 클릭 유도
  navigateTo?: string;  // 화면 단계: 진입 시 해당 경로로 이동
  wide?: boolean;       // 넓은 대상(중앙 메인) — 툴팁을 하단 중앙에 배치
};

// 메뉴 설명(menu) + 그 메뉴를 열었을 때 중앙 화면 설명(screen)
const MENU_INFO: Record<string, { title: string; menu: string; screen: string }> = {
  "/": { title: "대시보드", menu: "자산 현황을 요약해 보여주는 첫 화면입니다.", screen: "상단 요약 카드(총 자산·상태별 수)와 데이터 품질 점수, 관리자별·OS별 분포, 최근 변경 목록을 봅니다. 조회 시점 스냅샷이라 새로고침해야 갱신됩니다." },
  "/assets": { title: "자산관리", menu: "서버·네트워크 장비 등 자산을 다루는 핵심 메뉴입니다.", screen: "검색·필터로 자산을 찾고, 행을 클릭해 상세/수정합니다. 상단 버튼으로 신규 등록·엑셀 임포트/익스포트·일괄편집을 할 수 있습니다." },
  "/subassets": { title: "부속자산", menu: "장비에 딸린 부속(모듈·라이선스 등) 관리 메뉴입니다.", screen: "부속자산 목록에서 조회·등록하고, 상위 자산과 연결하거나 해제합니다." },
  "/racks": { title: "랙 실장도", menu: "장비의 물리적 실장 위치를 보는 메뉴입니다.", screen: "랙을 선택하면 U 위치별 장비 배치가 그려집니다. 장비를 배치·이동하고 빈 슬롯을 확인합니다." },
  "/ipam": { title: "IP관리", menu: "서브넷·IP 할당 현황 메뉴입니다.", screen: "서브넷별 IP 사용 현황을 보고, IP를 할당하거나 회수합니다." },
  "/distribution": { title: "배선관리", menu: "배선반·결선 정보를 다루는 메뉴입니다.", screen: "배선반(프레임)과 결선(페어)을 등록하고 연결 경로를 추적합니다." },
  "/movements": { title: "반입/반출", menu: "장비 반입·반출 신청/승인 메뉴입니다.", screen: "신청 목록에서 상태를 확인하고, 신규 반입/반출을 신청하거나 승인 처리합니다." },
  "/maintenance": { title: "유지보수", menu: "유지보수 이력·유지관리 대상 메뉴입니다.", screen: "유지보수 이력과 유지관리 대상·금액을 탭으로 나눠 기록·조회합니다." },
  "/inspection": { title: "자산실사", menu: "정기 실사 메뉴입니다.", screen: "실사 회차를 만들고 항목을 전수 확인/체크한 뒤 마감(스냅샷)합니다." },
  "/contracts": { title: "계약관리", menu: "유지보수·임대 계약 메뉴입니다.", screen: "계약을 등록하고 자산을 연결하며, 만료 임박 계약을 확인합니다." },
  "/reports": { title: "통계 리포트", menu: "제출·인쇄용 통계 메뉴입니다.", screen: "조건을 지정해 통계를 만들고 인쇄하거나 PDF로 저장합니다." },
  "/locations": { title: "위치관리", menu: "건물·층·실 위치 마스터 메뉴입니다.", screen: "위치를 등록·정렬하고, 자산·랙 배치의 기준으로 사용합니다." },
  "/logs": { title: "로그/감사", menu: "접속·변경 감사 메뉴입니다(총괄 전용).", screen: "접속기록과 데이터 변경 감사 로그를 조건으로 필터해 조회합니다." },
  "/settings": { title: "설정", menu: "계정·권한·메일 등 시스템 설정 메뉴입니다.", screen: "탭에서 비밀번호 변경, 사용자·팀·권한 관리, 메일 설정을 합니다." },
};

function cssAttr(href: string): string {
  return `[data-onboard-href="${href.replace(/"/g, '\\"')}"]`;
}

export function Onboarding() {
  const pathname = usePathname();
  const router = useRouter();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const buildSteps = useCallback((): Step[] => {
    const hrefs = Array.from(document.querySelectorAll<HTMLElement>('[data-onboard="menu"]'))
      .map((el) => el.getAttribute("data-onboard-href") || "")
      .filter((href) => MENU_INFO[href]);
    const menuSteps: Step[] = hrefs.flatMap((href) => {
      const info = MENU_INFO[href];
      return [
        { selector: cssAttr(href), title: info.title, desc: info.menu, clickable: true },
        { selector: '[data-onboard="main"]', title: `${info.title} 화면`, desc: info.screen, navigateTo: href, wide: true },
      ];
    });
    return [
      { title: "정보시스템 자산관리에 오신 걸 환영합니다 👋", desc: "주요 메뉴와 각 화면을 짧게 안내해 드릴게요. 메뉴 → 그 메뉴의 중앙 화면 순서로 살펴봅니다. 언제든 '건너뛰기'로 종료할 수 있어요." },
      ...menuSteps,
      { selector: '[data-onboard="nav"]', title: "메뉴 순서 바꾸기", desc: "메뉴를 마우스로 끌어다 놓으면 순서를 바꿀 수 있어요. 자주 쓰는 메뉴를 위로 올려 보세요." },
      { selector: '[data-onboard="help"]', title: "언제든 다시 보기", desc: "이 안내가 다시 필요하면 좌측 하단의 '도움말' 버튼을 누르면 됩니다." },
      { title: "준비 완료! 🎉", desc: "이제 직접 사용해 보세요. 궁금하면 언제든 도움말에서 이 안내를 다시 볼 수 있어요." },
    ];
  }, []);

  const startTour = useCallback((from = 0) => {
    const s = buildSteps();
    const start = Math.min(Math.max(0, from), s.length - 1);
    setSteps(s);
    setIdx(start);
    try { sessionStorage.setItem(RUN_KEY, String(start)); } catch { /* 무시 */ }
  }, [buildSteps]);

  const endTour = useCallback(() => {
    setSteps(null); setIdx(0); setRect(null);
    try { sessionStorage.removeItem(RUN_KEY); } catch { /* 무시 */ }
    try { localStorage.setItem(DONE_KEY, "1"); } catch { /* 무시 */ }
  }, []);

  // 재실행 트리거 + 세션 재개 + 최초 자동 시작
  useEffect(() => {
    const onStart = () => startTour(0);
    window.addEventListener("asset:onboarding-start", onStart);

    let resumed = false;
    try {
      const r = sessionStorage.getItem(RUN_KEY);
      if (r != null) { startTour(Number(r) || 0); resumed = true; }
    } catch { /* 무시 */ }

    let timer: ReturnType<typeof setInterval> | null = null;
    let stopper: ReturnType<typeof setTimeout> | null = null;
    if (!resumed) {
      let done = false;
      try { done = localStorage.getItem(DONE_KEY) === "1"; } catch { /* 무시 */ }
      if (!done) {
        timer = setInterval(() => {
          if (document.querySelector('[data-onboard="menu"]')) {
            if (timer) clearInterval(timer);
            startTour(0);
          }
        }, 300);
        stopper = setTimeout(() => { if (timer) clearInterval(timer); }, 6000);
      }
    }
    return () => {
      window.removeEventListener("asset:onboarding-start", onStart);
      if (timer) clearInterval(timer);
      if (stopper) clearTimeout(stopper);
    };
  }, [startTour]);

  const step = steps ? steps[idx] : null;

  // 화면 단계: 진입 시 해당 경로로 이동 (중앙에 실제 화면을 띄운다)
  useEffect(() => {
    if (step?.navigateTo && pathname !== step.navigateTo) {
      router.push(step.navigateTo);
    }
  }, [step, idx, pathname, router]);

  // 대상 요소 위치 추적 (페이지 이동·스크롤·리사이즈 대응)
  useEffect(() => {
    if (!step || !step.selector) { setRect(null); return; }
    const sel = step.selector;
    document.querySelector<HTMLElement>(sel)?.scrollIntoView({ block: "nearest" });
    const compute = () => {
      const el = document.querySelector<HTMLElement>(sel);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    compute();
    const id = setInterval(compute, 250);
    window.addEventListener("resize", compute);
    return () => { clearInterval(id); window.removeEventListener("resize", compute); };
  }, [step, idx, pathname]);

  if (!steps || !step) return null;

  const total = steps.length;
  const isLast = idx === total - 1;
  const goto = (n: number) => {
    const c = Math.min(Math.max(0, n), total - 1);
    setIdx(c);
    try { sessionStorage.setItem(RUN_KEY, String(c)); } catch { /* 무시 */ }
  };
  const next = () => { if (isLast) endTour(); else goto(idx + 1); };
  const prev = () => goto(idx - 1);

  const hasSpot = !!(step.selector && rect);
  const pad = step.wide ? 4 : 6;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  const tipW = step.wide ? 440 : hasSpot ? 320 : 360;
  let tipStyle: React.CSSProperties;
  if (hasSpot && rect && step.wide) {
    // 넓은 중앙 대상: 화면이 가려지지 않게 하단 중앙에 배치
    const cx = rect.left + rect.width / 2;
    tipStyle = { position: "fixed", left: cx, top: Math.max(80, vh - 210), transform: "translateX(-50%)", width: tipW, zIndex: 10000, pointerEvents: "auto" };
  } else if (hasSpot && rect) {
    let left = rect.right + 14;
    if (left + tipW > vw - 12) left = Math.max(12, rect.left - tipW - 14);
    let top = Math.max(12, rect.top);
    if (top + 240 > vh - 12) top = Math.max(12, vh - 240 - 12);
    tipStyle = { position: "fixed", left, top, width: tipW, zIndex: 10000, pointerEvents: "auto" };
  } else {
    tipStyle = { position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: tipW, zIndex: 10000, pointerEvents: "auto" };
  }

  const dim = "bg-slate-900/55";
  const ringCls = step.wide ? "rounded-lg ring-2 ring-signal/70" : "rounded-lg ring-2 ring-signal animate-pulse";

  return (
    <div className="fixed inset-0 z-[9998]" style={{ pointerEvents: "none" }} aria-live="polite">
      {hasSpot && rect ? (
        <>
          {/* 4방향 딤(외부 차단) + 대상 영역은 통과 → 실제 메뉴/화면 조작 가능 */}
          <div className={dim} style={{ position: "fixed", left: 0, top: 0, width: "100%", height: Math.max(0, rect.top - pad), pointerEvents: "auto" }} />
          <div className={dim} style={{ position: "fixed", left: 0, top: rect.bottom + pad, width: "100%", height: Math.max(0, vh - rect.bottom - pad), pointerEvents: "auto" }} />
          <div className={dim} style={{ position: "fixed", left: 0, top: rect.top - pad, width: Math.max(0, rect.left - pad), height: rect.height + pad * 2, pointerEvents: "auto" }} />
          <div className={dim} style={{ position: "fixed", left: rect.right + pad, top: rect.top - pad, width: Math.max(0, vw - rect.right - pad), height: rect.height + pad * 2, pointerEvents: "auto" }} />
          {/* 하이라이트 링 */}
          <div className={ringCls} style={{ position: "fixed", left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, pointerEvents: "none" }} />
        </>
      ) : (
        <div className={`fixed inset-0 ${dim}`} style={{ pointerEvents: "auto" }} />
      )}

      <div style={tipStyle} className="rounded-xl bg-white shadow-2xl border border-line p-5">
        <div className="flex items-start justify-between gap-3 mb-1.5">
          <h3 className="text-base font-semibold text-ink flex items-center gap-1.5">
            {!hasSpot && <Sparkles size={16} className="text-signal" />}
            {step.wide && <MonitorPlay size={16} className="text-signal" />}
            {step.title}
          </h3>
          <button onClick={endTour} className="text-ink-3 hover:text-ink -mt-1 -mr-1 p-1" title="건너뛰기"><X size={16} /></button>
        </div>
        <p className="text-sm text-ink-2 leading-relaxed">{step.desc}</p>
        {step.clickable && (
          <p className="mt-2 text-xs text-signal flex items-center gap-1"><MousePointerClick size={13} /> 하이라이트된 메뉴를 직접 클릭해 열어볼 수 있어요.</p>
        )}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-ink-3">{idx + 1} / {total}</span>
          <div className="flex items-center gap-1.5">
            <button onClick={endTour} className="px-2.5 py-1.5 text-xs text-ink-3 hover:text-ink">건너뛰기</button>
            {idx > 0 && (
              <button onClick={prev} className="px-2.5 py-1.5 text-xs rounded-md border border-line hover:bg-slate-50 flex items-center gap-1">
                <ChevronLeft size={13} /> 이전
              </button>
            )}
            <button onClick={next} className="px-3 py-1.5 text-xs rounded-md btn-ink flex items-center gap-1">
              {isLast ? <><Check size={13} /> 완료</> : <>다음 <ChevronRight size={13} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

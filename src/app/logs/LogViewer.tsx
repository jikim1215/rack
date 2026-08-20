"use client";

import { useCallback, useEffect, useState } from "react";
import { ScrollText, RefreshCw } from "lucide-react";

interface AccessLog {
  id: number;
  user_id: number | null;
  username: string | null;
  ip: string | null;
  user_agent: string | null;
  action: string;
  result_code: number | string | null;
  failure_reason: string | null;
  created_at: string;
}

interface AuditLog {
  id: number;
  entity_type: string;
  entity_id: number | string | null;
  entity_name: string | null;
  action: string;
  changed_by: string | null;
  changed_fields: string[] | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
}

type Tab = "access" | "audit";

const accessActionLabels: Record<string, string> = {
  login: "로그인",
  logout: "로그아웃",
  fail: "실패",
};

const auditActionLabels: Record<string, string> = {
  create: "생성",
  update: "수정",
  delete: "삭제",
};

const entityTypeLabels: Record<string, string> = {
  asset: "자산",
  rack: "랙",
  location: "위치",
  frame: "배선반",
  contract: "계약",
  movement: "반입/반출",
  maintenance: "유지보수",
  inventory_audit: "자산실사",
  sub_asset: "부속자산",
};

const PAGE_SIZE = 50;

/** 이중 배치용 페이저 — 필터바 우측 + 테이블 하단 (1년치 수만 행 대비 서버측 페이지네이션) */
function Pager({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return null;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-600">
      <button className="btn px-2 py-1 disabled:opacity-40" disabled={page <= 0} onClick={() => onChange(page - 1)}>이전</button>
      <span className="num">{page + 1} / {pages}</span>
      <span className="text-xs text-slate-400">{PAGE_SIZE}건씩</span>
      <button className="btn px-2 py-1 disabled:opacity-40" disabled={page >= pages - 1} onClick={() => onChange(page + 1)}>다음</button>
    </span>
  );
}

function fmtTime(value: string): string {
  if (!value) return "-";
  // DB는 datetime('now','localtime')로 이미 로컬(KST) 문자열을 저장한다.
  // "Z"(UTC 표식)를 붙이면 브라우저가 +9h 재변환해 시각이 어긋난다 → 로컬로 파싱.
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function LogViewer() {
  const [tab, setTab] = useState<Tab>("access");

  // 접속기록 상태
  const [accessAction, setAccessAction] = useState<string>("");
  const [accessUser, setAccessUser] = useState<string>("");
  const [accessRows, setAccessRows] = useState<AccessLog[]>([]);
  const [accessTotal, setAccessTotal] = useState(0);
  const [accessPage, setAccessPage] = useState(0);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState("");

  // 감사로그 상태
  const [entityType, setEntityType] = useState<string>("");
  const [auditRows, setAuditRows] = useState<AuditLog[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");

  const loadAccess = useCallback(async () => {
    setAccessLoading(true);
    setAccessError("");
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(accessPage * PAGE_SIZE) });
      if (accessAction) qs.set("action", accessAction);
      if (accessUser.trim()) qs.set("username", accessUser.trim());
      const res = await fetch(`/api/access-logs?${qs.toString()}`);
      if (!res.ok) {
        setAccessError(res.status === 403 || res.status === 401 ? "접근 권한이 없습니다." : "접속기록을 불러오지 못했습니다.");
        setAccessRows([]);
        return;
      }
      const data = await res.json();
      setAccessRows(Array.isArray(data) ? data : data.rows ?? []);
      setAccessTotal(Array.isArray(data) ? data.length : data.total ?? 0);
    } catch {
      setAccessError("서버 연결에 실패했습니다.");
      setAccessRows([]);
    } finally {
      setAccessLoading(false);
    }
  }, [accessAction, accessUser, accessPage]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    setAuditError("");
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(auditPage * PAGE_SIZE) });
      if (entityType) qs.set("entity_type", entityType);
      const res = await fetch(`/api/audit?${qs.toString()}`);
      if (!res.ok) {
        setAuditError(res.status === 403 || res.status === 401 ? "접근 권한이 없습니다." : "감사로그를 불러오지 못했습니다.");
        setAuditRows([]);
        return;
      }
      const data = await res.json();
      setAuditRows(Array.isArray(data) ? data : data.rows ?? []);
      setAuditTotal(Array.isArray(data) ? data.length : data.total ?? 0);
    } catch {
      setAuditError("서버 연결에 실패했습니다.");
      setAuditRows([]);
    } finally {
      setAuditLoading(false);
    }
  }, [entityType, auditPage]);

  useEffect(() => {
    if (tab === "access") loadAccess();
  }, [tab, loadAccess]);

  useEffect(() => {
    if (tab === "audit") loadAudit();
  }, [tab, loadAudit]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="eyebrow">LOGS &amp; AUDIT</div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ScrollText size={22} /> 로그/감사
          </h2>
          <p className="text-sm text-slate-500 mt-1">사용자 접속기록과 데이터 변경 감사로그를 총괄이 조회합니다.</p>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        <button
          onClick={() => setTab("access")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "access" ? "border-signal text-signal" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          접속기록
        </button>
        <button
          onClick={() => setTab("audit")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "audit" ? "border-signal text-signal" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          감사로그
        </button>
      </div>

      {tab === "access" ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="text-sm text-slate-600">동작</label>
            <select
              value={accessAction}
              onChange={(e) => { setAccessAction(e.target.value); setAccessPage(0); }}
              className="form-input !w-auto"
            >
              <option value="">전체</option>
              <option value="login">로그인</option>
              <option value="logout">로그아웃</option>
              <option value="fail">실패</option>
            </select>
            <input
              value={accessUser}
              onChange={(e) => { setAccessUser(e.target.value); setAccessPage(0); }}
              placeholder="사용자 검색"
              className="form-input !w-36"
            />
            <button
              onClick={loadAccess}
              disabled={accessLoading}
              className="btn inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw size={14} className={accessLoading ? "animate-spin" : ""} /> 새로고침
            </button>
            <span className="text-sm text-slate-500">총 <span className="num">{accessTotal}</span>건</span>
            {accessError && <span className="text-sm text-fault">{accessError}</span>}
            <span className="ml-auto"><Pager page={accessPage} total={accessTotal} onChange={setAccessPage} /></span>
          </div>

          {accessLoading ? (
            <p className="text-sm text-slate-500 py-8 text-center">불러오는 중…</p>
          ) : accessRows.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">기록 없음</p>
          ) : (<>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b">
                    <th className="py-2 whitespace-nowrap">시각</th>
                    <th className="py-2">사용자</th>
                    <th className="py-2">IP</th>
                    <th className="py-2">동작</th>
                    <th className="py-2">결과</th>
                    <th className="py-2">사유</th>
                    <th className="py-2">User-Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {accessRows.map((r) => (
                    <tr key={r.id} className={`border-b last:border-0 ${r.action === "fail" ? "text-fault" : ""}`}>
                      <td className="py-2 whitespace-nowrap">{fmtTime(r.created_at)}</td>
                      <td className="py-2 font-medium">{r.username || "-"}</td>
                      <td className="py-2">{r.ip || "-"}</td>
                      <td className="py-2">{accessActionLabels[r.action] || r.action}</td>
                      <td className="py-2">{r.result_code ?? "-"}</td>
                      <td className="py-2">{r.failure_reason || "-"}</td>
                      <td className="py-2 max-w-[220px] truncate" title={r.user_agent || ""}>{r.user_agent || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-right"><Pager page={accessPage} total={accessTotal} onChange={setAccessPage} /></div>
          </>)}
        </div>
      ) : (
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="text-sm text-slate-600">엔터티</label>
            <select
              value={entityType}
              onChange={(e) => { setEntityType(e.target.value); setAuditPage(0); }}
              className="form-input !w-auto"
            >
              <option value="">전체</option>
              {Object.entries(entityTypeLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button
              onClick={loadAudit}
              disabled={auditLoading}
              className="btn inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw size={14} className={auditLoading ? "animate-spin" : ""} /> 새로고침
            </button>
            <span className="text-sm text-slate-500">총 <span className="num">{auditTotal}</span>건</span>
            {auditError && <span className="text-sm text-fault">{auditError}</span>}
            <span className="ml-auto"><Pager page={auditPage} total={auditTotal} onChange={setAuditPage} /></span>
          </div>

          <p className="text-xs text-warn mb-4">
            감사로그는 append-only (수정/삭제 불가, 1년 보존)
          </p>

          {auditLoading ? (
            <p className="text-sm text-slate-500 py-8 text-center">불러오는 중…</p>
          ) : auditRows.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">기록 없음</p>
          ) : (<>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b">
                    <th className="py-2 whitespace-nowrap">시각</th>
                    <th className="py-2">엔터티</th>
                    <th className="py-2">동작</th>
                    <th className="py-2">수행자</th>
                    <th className="py-2">변경필드</th>
                    <th className="py-2">변경내용</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map((r) => {
                    const fields = Array.isArray(r.changed_fields) ? r.changed_fields : [];
                    const diff = fields
                      .map((f) => {
                        const oldV = r.old_values?.[f];
                        const newV = r.new_values?.[f];
                        return `${f}: ${fmtVal(oldV)} → ${fmtVal(newV)}`;
                      })
                      .join("\n");
                    return (
                      <tr key={r.id} className="border-b last:border-0 align-top">
                        <td className="py-2 whitespace-nowrap">{fmtTime(r.created_at)}</td>
                        <td className="py-2">
                          <span className="text-slate-500">{entityTypeLabels[r.entity_type] || r.entity_type}</span>
                          {r.entity_name ? <span className="ml-1 font-medium">{r.entity_name}</span> : null}
                        </td>
                        <td className="py-2">
                          <span className={r.action === "delete" ? "text-fault" : r.action === "create" ? "text-signal" : ""}>
                            {auditActionLabels[r.action] || r.action}
                          </span>
                        </td>
                        <td className="py-2">{r.changed_by || "-"}</td>
                        <td className="py-2">{fields.length ? fields.join(", ") : "-"}</td>
                        <td className="py-2 max-w-[280px] truncate" title={diff}>
                          {diff ? diff.replace(/\n/g, " | ") : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-right"><Pager page={auditPage} total={auditTotal} onChange={setAuditPage} /></div>
          </>)}
        </div>
      )}
    </div>
  );
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

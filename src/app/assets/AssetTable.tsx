"use client";

import { useState, useEffect, Fragment } from "react";
import {
  Plus, Search, Pencil, Trash2, X, Save, ChevronDown, ChevronUp, ChevronRight,
  Settings, Upload, Download, FileSpreadsheet, AlertCircle, History,
} from "lucide-react";
import { splitAccessIps } from "@/lib/access-ip";
import { UsageGuide } from "@/components/UsageGuide";

const typeLabels: Record<string, string> = {
  server: "서버", network: "네트워크", security: "정보보호", telecom: "전화설비", vm: "가상머신", other: "기타",
};
const typeColors: Record<string, string> = {
  server: "bg-slate-100 text-ink",
  network: "bg-slate-100 text-ink",
  security: "bg-slate-100 text-ink",
  telecom: "bg-slate-100 text-ink",
  other: "bg-slate-100 text-ink",
  vm: "bg-slate-100 text-ink",
};
const statusLabels: Record<string, string> = {
  active: "운용중", maintenance: "점검중", standby: "예비", retired: "폐기",
};
const statusColors: Record<string, string> = {
  active: "text-signal", maintenance: "text-warn",
  standby: "text-idle", retired: "text-fault",
};
const statusLed: Record<string, string> = {
  active: "led-up", maintenance: "led-warn",
  standby: "led-idle", retired: "led-fault",
};

const zoneLabels: Record<string, string> = { "업무망": "업무망", "인터넷망": "인터넷망" };
const ciaGradeColors: Record<string, string> = {
  H: "bg-red-50 text-fault", M: "bg-amber-50 text-warn", L: "bg-slate-100 text-ink-2",
};

interface Asset {
  id: number;
  asset_type: string;
  asset_name: string;

  manufacturer: string;
  model: string;
  serial_number: string;
  ip_address: string;
  asset_tag: string;
  status: string;
  os: string;
  access_ip: string;
  user_name: string;
  admin_name: string;
  department: string;
  team_name?: string | null;
  team_id: number | null;
  network_zone: string;
  cia_c: number | null;
  cia_i: number | null;
  cia_a: number | null;
  cia_total: number | null;
  cia_grade: string;
  purchase_date: string;
  warranty_date: string;
  eos_date: string;
  rack_id: number | null;
  rack_name: string | null;
  location_name: string | null;
  rack_unit_start: number | null;
  rack_unit_size: number;
  rack_side: "L" | "R" | null; // 반폭 배치: L(좌)/R(우), null=전폭
  description: string;

}

interface CustomField {
  id: number;
  field_key: string;
  field_label: string;
  field_type: string;
  field_group: string;
  options: string;
  asset_types: string;
  sort_order: number;
  is_required: number;
  show_in_table: number;
  show_in_detail: number;
}

const emptyAsset = {
  asset_type: "server", asset_name: "", manufacturer: "", model: "",
  serial_number: "", ip_address: "", asset_tag: "", status: "active",
  os: "", access_ip: "", user_name: "", admin_name: "", department: "",
  network_zone: "", cia_c: "", cia_i: "", cia_a: "",
  purchase_date: "", warranty_date: "", eos_date: "",
  rack_id: null as number | null, rack_unit_start: null as number | null,
  rack_unit_size: 1, rack_side: null as "L" | "R" | null, description: "",
};


interface Props {
  assets: Asset[];
  racks: any[];
  customFields: CustomField[];
  customValuesMap: Record<number, Record<number, string>>;
  teams: { id: number; team_name: string }[];
  isAdmin: boolean;
  initialRackId?: string | null;
  initialMissing?: string | null;
  initialSearch?: string | null;
}

export function AssetTable({ assets: initialAssets, racks, customFields: initFields, customValuesMap: initCvMap, teams, isAdmin, initialRackId, initialMissing, initialSearch }: Props) {
  const [assets, setAssets] = useState(initialAssets);
  const [search, setSearch] = useState(initialSearch || "");
  const [typeFilter, setTypeFilter] = useState("");
  const [rackFilter, setRackFilter] = useState<string>(initialRackId || "");
  // 라이프사이클 넛지 필터: ?missing=ip|rack (대시보드 흐름 카드에서 진입)
  const [missingFilter, setMissingFilter] = useState<string>(
    initialMissing === "ip" || initialMissing === "rack" ? initialMissing : ""
  );
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyAsset);

  // ── 폼 임시보존 (외부 검토 P0 합의): 세션 만료/새로고침으로 작성 중 입력이 유실되지 않게
  // 폼이 열려 있는 동안 sessionStorage에 초안을 저장하고, 재진입 시 복구를 제안한다.
  const DRAFT_KEY = "asset-form-draft";
  const [draft, setDraft] = useState<{ editId: number | null; form: typeof emptyAsset } | null>(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d?.form?.asset_name !== undefined) setDraft(d);
      }
    } catch { /* 초안 복구 실패는 무해 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!showForm) return;
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ editId, form })); } catch { /* 저장 불가 환경 무시 */ }
  }, [showForm, editId, form]);
  function clearDraft() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* 무시 */ }
    setDraft(null);
  }
  // 반복 입력 편의: 직전 등록 자산의 공통 맥락(유형/망구분/상태/랙/사용자/관리자/OS)을 기억해 다음 '자산 등록' 시 프리필.
  const [lastAssetCommon, setLastAssetCommon] = useState<Partial<typeof emptyAsset>>({});
  const [customValues, setCustomValues] = useState<Record<number, string>>({});
  const [cvMap, setCvMap] = useState(initCvMap);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // 유형(asset_type) 접이식 그룹: 자산이 많아(수백 행) 한 번에 다 펼치지 않고 유형 헤더 클릭 시 펼침.
  // 대규모 렌더 안전장치: 그룹당 RENDER_CAP행까지만 우선 렌더, 초과분은 '더 표시'로 확장.
  const RENDER_CAP = 200;
  const [uncappedTypes, setUncappedTypes] = useState<Set<string>>(new Set());
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(() => {
    const initFiltered = initialAssets.filter((a) => !initialRackId || a.rack_id === Number(initialRackId));
    // 초기 결과가 30건 이하면 모든 유형 펼침, 그보다 많으면 전부 접힌 상태로 시작.
    if (initFiltered.length > 30) return new Set();
    return new Set(initFiltered.map((a) => a.asset_type));
  });
  const toggleType = (t: string) =>
    setExpandedTypes((prev) => {
      const n = new Set(prev);
      if (n.has(t)) n.delete(t); else n.add(t);
      return n;
    });

  // 커스텀 필드 관리
  const [customFields, setCustomFields] = useState(initFields);
  const [showFieldManager, setShowFieldManager] = useState(false);
  const [fieldForm, setFieldForm] = useState({
    field_key: "", field_label: "", field_type: "text", field_group: "기본",
    options: "", asset_types: "", is_required: 0, show_in_table: 0, show_in_detail: 1,
  });
  const [editFieldId, setEditFieldId] = useState<number | null>(null);

  // 일괄등록
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // 프리뷰 승인 대기 파일 (외부 검토 R6-2 합의: 반영 전 생성 예정/중복 의심 요약을 먼저 보여준다)
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  // 테이블에 표시할 커스텀 필드
  const tableCustomFields = customFields.filter((f) => f.show_in_table);
  // 추가 IP(additional_ips 커스텀필드)도 검색 대상에 포함 — 값은 JSON 배열 문자열이라 부분일치로 매칭
  const addlIpFieldId = customFields.find((f) => f.field_key === "additional_ips")?.id;

  const filtered = assets.filter((a) => {
    if (typeFilter && a.asset_type !== typeFilter) return false;
    if (rackFilter && a.rack_id !== Number(rackFilter)) return false;
    if (missingFilter === "ip" && (a.ip_address || "").trim() !== "") return false;
    if (missingFilter === "rack" && a.rack_id != null) return false;
    if (missingFilter && a.status === "retired") return false; // 폐기 자산은 정비 대상 아님
    if (search) {
      const q = search.toLowerCase();
      return (
        a.asset_name.toLowerCase().includes(q) ||

        a.ip_address.toLowerCase().includes(q) ||
        (a.access_ip || "").toLowerCase().includes(q) ||
        a.manufacturer.toLowerCase().includes(q) ||
        a.model.toLowerCase().includes(q) ||
        a.serial_number.toLowerCase().includes(q) ||
        a.os.toLowerCase().includes(q) ||
        a.admin_name.toLowerCase().includes(q) ||
        a.user_name.toLowerCase().includes(q) ||
        (a.team_name || "").toLowerCase().includes(q) ||
        a.department.toLowerCase().includes(q) ||
        (addlIpFieldId != null && (cvMap[a.id]?.[addlIpFieldId] || "").toLowerCase().includes(q))
      );
    }
    return true;
  });

  // 유형 고정 정렬 순서: 서버 → 네트워크 → 정보보호 → 전화설비 → 가상머신 → 기타 → 그 외(가나다순)
  const typeOrder = ["server", "network", "security", "telecom", "vm", "other"];
  const assetGroups = (() => {
    const m = new Map<string, Asset[]>();
    for (const a of filtered) {
      const arr = m.get(a.asset_type);
      if (arr) arr.push(a); else m.set(a.asset_type, [a]);
    }
    return [...m.entries()].sort((x, y) => {
      const ix = typeOrder.indexOf(x[0]);
      const iy = typeOrder.indexOf(y[0]);
      const rx = ix === -1 ? typeOrder.length : ix;
      const ry = iy === -1 ? typeOrder.length : iy;
      if (rx !== ry) return rx - ry;
      return x[0].localeCompare(y[0], "ko");
    });
  })();
  // 그룹 헤더 colSpan = 고정 11열(선택·토글·유형·망구분·이름·제조사/모델·IP·관리부서·위치·상태·관리) + 테이블 커스텀 필드 수
  const groupColSpan = 11 + tableCustomFields.length;
  // 검색/필터가 활성화되면 매칭 결과가 접힌 그룹에 숨지 않도록 해당 그룹을 자동으로 펼친다.
  const isFiltering = search.trim() !== "" || typeFilter !== "" || rackFilter !== "" || missingFilter !== "";
  const expandAllTypes = () => setExpandedTypes(new Set(assetGroups.map(([t]) => t)));
  const collapseAllTypes = () => setExpandedTypes(new Set());
  const allExpanded = assetGroups.length > 0 && assetGroups.every(([t]) => expandedTypes.has(t));

  // 검색결과 일괄수정: 행 선택(체크박스) → 망구분/상태/관리자/사용자/보안등급 일괄 변경
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  type BulkField = "network_zone" | "status" | "admin_name" | "user_name" | "cia_c" | "cia_i" | "cia_a" | "team_id";
  const [bulkField, setBulkField] = useState<BulkField>("network_zone");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSelect = (id: number) =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  // 현재 검색/필터 결과(filtered) 기준 선택 — 화면에 보이는 대상만 선택/적용한다.
  const filteredIds = filtered.map((a) => a.id);
  const selectedVisibleIds = filteredIds.filter((id) => selectedIds.has(id));
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const toggleSelectAll = () =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (allSelected) filteredIds.forEach((id) => n.delete(id));
      else filteredIds.forEach((id) => n.add(id));
      return n;
    });
  const clearSelection = () => setSelectedIds(new Set());

  function getFieldsForType(assetType: string) {
    return customFields.filter((f) => {
      if (!f.asset_types) return true;
      return f.asset_types.split(",").map((s: string) => s.trim()).includes(assetType);
    });
  }

  // 그룹별로 필드 분류
  function getFieldsByGroup(assetType: string) {
    const fields = getFieldsForType(assetType);
    const groups: Record<string, CustomField[]> = {};
    for (const f of fields) {
      const g = f.field_group || "기본";
      if (!groups[g]) groups[g] = [];
      groups[g].push(f);
    }
    return groups;
  }

  // --- 일괄등록 파일 처리 (드래그앤드롭 / 클릭선택 공용) ---
  // 1단계: 프리뷰(dry_run) — 반영 없이 생성 예정/이슈/기존 중복 요약. 2단계: confirmImport()로 실제 반영.
  async function handleImportFile(file: File | undefined | null) {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      setImportResult({ success: false, error: "엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다." });
      return;
    }
    setImporting(true); setImportResult(null); setPendingImportFile(null);
    const fd = new FormData(); fd.append("file", file); fd.append("dry_run", "1");
    try {
      const res = await fetch("/api/assets/import", { method: "POST", body: fd });
      const data = await res.json();
      setImportResult(data);
      if (data.preview) setPendingImportFile(file);
    } catch { setImportResult({ success: false, error: "업로드 실패" }); }
    finally { setImporting(false); }
  }

  // 2단계: 프리뷰 확인 후 실제 반영
  async function confirmImport() {
    if (!pendingImportFile) return;
    setImporting(true);
    const fd = new FormData(); fd.append("file", pendingImportFile);
    try {
      const res = await fetch("/api/assets/import", { method: "POST", body: fd });
      const data = await res.json(); setImportResult(data); setPendingImportFile(null);
      if (data.imported > 0) {
        const r = await fetch("/api/assets"); if (r.ok) setAssets(await r.json());
      }
    } catch { setImportResult({ success: false, error: "업로드 실패" }); }
    finally { setImporting(false); }
  }

  // 배치 롤백 (admin): 이 배치로 생성된 자산 전량 삭제 — 임포트는 INSERT 전용이라 생성분 삭제 = 완전 복구
  async function rollbackImportBatch(batchId: string, count: number) {
    // 사전 집계 조회 (외부 검토 2차 R1-3 합의): 삭제 예상량 분해를 보고 결정하게 한다
    let breakdown = "";
    try {
      const pv = await fetch("/api/assets/import/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: batchId, preview: true }),
      });
      if (pv.ok) {
        const p = await pv.json();
        breakdown = `\n삭제 예상: 생성 자산 ${p.total}건 (이 중 임포트 후 수정됨 ${p.modified}건, 계약·IP·실사·부속 연결 보유 ${p.linked}건)\n미조치 정리큐 이슈 ${p.open_issues}건은 '무시'로 자동 정리됩니다.\n`;
      }
    } catch { /* 집계 실패 시 기본 문구로 진행 */ }
    if (!confirm(`이 배치(${batchId})로 생성된 자산 ${count}건을 모두 삭제하시겠습니까?\n${breakdown}\n임포트 후 수정한 자산도 함께 삭제됩니다. 되돌리기는 다시 임포트하는 방법뿐입니다(삭제 이력은 감사로그 보존).`)) return;
    const res = await fetch("/api/assets/import/rollback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batch_id: batchId }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || "롤백에 실패했습니다."); return; }
    setImportResult(null);
    const r = await fetch("/api/assets"); if (r.ok) setAssets(await r.json());
    alert(`배치 롤백 완료 — ${data.deleted}건 삭제됨`);
  }

  // 생성 목록 CSV 다운로드 (사후 검증·보고용)
  function downloadCreatedCsv() {
    const rows: any[] = importResult?.created || [];
    if (!rows.length) return;
    const csv = "\uFEFFid,자산명,원본행\n" + rows.map((c) => `${c.id},"${String(c.asset_name).replace(/"/g, '""')}",${c.source_row}`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `import-${importResult.batch_id || "batch"}-created.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function handleSave() {
    if (!form.asset_name.trim()) { alert("자산 이름을 입력하세요."); return; }
    const url = editId ? `/api/assets/${editId}` : "/api/assets";
    const method = editId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, custom_values: customValues }),
    });
    if (res.ok) {
      const data = await res.json();
      if (editId) {
        setAssets((prev) => prev.map((a) => (a.id === editId ? { ...a, ...data } : a)));
        setCvMap((prev) => ({ ...prev, [editId]: { ...customValues } }));
      } else {
        setAssets((prev) => [data, ...prev]);
        setCvMap((prev) => ({ ...prev, [data.id]: { ...customValues } }));
        // 다음 등록을 위해 공통 맥락 필드 기억(식별자 필드는 매번 비움)
        setLastAssetCommon({
          asset_type: form.asset_type, network_zone: form.network_zone, status: form.status,
          rack_id: form.rack_id, user_name: form.user_name, admin_name: form.admin_name, os: form.os,
        });
      }
      setShowForm(false);
      setEditId(null);
      setForm(emptyAsset);
      setCustomValues({});
      clearDraft();
    } else {
      const data = await res.json().catch(() => null);
      alert(data?.error || `저장에 실패했습니다 (HTTP ${res.status}).`);
    }
  }

  async function handleDelete(id: number) {
    // confirm 4요소: 대상 / 동작 / 자동 후속처리 / 되돌리기 가능 여부 (외부 검토 P1-2 합의)
    const target = assets.find((a) => a.id === id);
    const ident = target ? `'${target.asset_name}'${target.asset_tag ? ` (자산태그 ${target.asset_tag})` : target.serial_number ? ` (S/N ${target.serial_number})` : ""}` : "이 자산";
    if (!confirm(`${ident} 자산을 삭제하시겠습니까?\n\n자동 처리: 랙 실장·IP·계약 연결이 함께 제거되고, 연결된 부속자산은 연결만 해제되어 남습니다.\n삭제는 되돌릴 수 없습니다(변경이력은 감사로그에 보존).`)) return;
    const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
    if (res.ok) setAssets((prev) => prev.filter((a) => a.id !== id));
  }

  // 선택한 자산의 망구분/상태를 일괄 변경 (서버측 scope로 권한 밖 자산은 제외됨)
  async function handleBulkApply() {
    const ids = filtered.map((a) => a.id).filter((id) => selectedIds.has(id));
    if (ids.length === 0) return;
    const FIELD_LABELS: Record<string, string> = {
      network_zone: "망구분", status: "상태", admin_name: "관리자", user_name: "사용자",
      cia_c: "기밀성(C)", cia_i: "무결성(I)", cia_a: "가용성(A)", team_id: "관리부서",
    };
    const isCia = bulkField === "cia_c" || bulkField === "cia_i" || bulkField === "cia_a";
    if (bulkField === "status" && !bulkValue) { alert("변경할 상태를 선택하세요."); return; }
    const fieldLabel = FIELD_LABELS[bulkField];
    const teamName = (id: string) => teams.find((t) => String(t.id) === id)?.team_name ?? "";
    const valueLabel =
      bulkField === "status" ? (statusLabels[bulkValue] || bulkValue)
      : bulkField === "network_zone" ? (bulkValue === "" ? "미지정" : bulkValue)
      : bulkField === "team_id" ? (bulkValue === "" ? "미지정" : teamName(bulkValue))
      : isCia ? (bulkValue === "" ? "미지정" : `${bulkValue}등급`)
      : (bulkValue === "" ? "(빈 값)" : bulkValue);
    if (!confirm(`선택한 ${ids.length}건의 ${fieldLabel}을(를) "${valueLabel}"(으)로 일괄 변경합니다. 변경이력이 자산별로 남습니다. 진행할까요?`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/assets/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_ids: ids, patch: { [bulkField]: bulkValue } }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        const idSet = new Set<number>(ids);
        // 로컬 반영: CIA는 숫자/널로 변환하고 생성열(cia_total/cia_grade)도 재계산
        const ciaNum = bulkValue === "" ? null : Number(bulkValue);
        setAssets((prev) => prev.map((a) => {
          if (!idSet.has(a.id)) return a;
          if (isCia) {
            const next = { ...a, [bulkField]: ciaNum } as Asset;
            const { cia_c, cia_i, cia_a } = next;
            if (cia_c == null || cia_i == null || cia_a == null) { next.cia_total = null; next.cia_grade = ""; }
            else { const t = cia_c + cia_i + cia_a; next.cia_total = t; next.cia_grade = t >= 7 ? "H" : t >= 5 ? "M" : "L"; }
            return next;
          }
          if (bulkField === "team_id") {
            const tid = bulkValue === "" ? null : Number(bulkValue);
            return { ...a, team_id: tid, team_name: tid == null ? null : (teams.find((t) => t.id === tid)?.team_name ?? null) } as Asset;
          }
          return { ...a, [bulkField]: bulkValue } as Asset;
        }));
        clearSelection();
        alert(`${data.updated}건 변경 완료${data.skipped ? ` (변경없음/권한밖 ${data.skipped}건 제외)` : ""}.`);
      } else {
        alert(data?.error || "일괄수정에 실패했습니다.");
      }
    } finally {
      setBulkBusy(false);
    }
  }

  // 선택한 자산 일괄삭제 (서버측 scope로 권한 밖 자산은 제외됨)
  async function handleBulkDelete() {
    const ids = filtered.map((a) => a.id).filter((id) => selectedIds.has(id));
    if (ids.length === 0) return;
    if (!confirm(`선택한 ${ids.length}건의 자산을 삭제합니다. 되돌릴 수 없습니다. 진행할까요?`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/assets/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_ids: ids }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        const idSet = new Set<number>(ids);
        setAssets((prev) => prev.filter((a) => !idSet.has(a.id)));
        clearSelection();
        alert(`${data.deleted}건 삭제 완료${data.skipped ? ` (권한밖 ${data.skipped}건 제외)` : ""}.`);
      } else {
        alert(data?.error || "일괄삭제에 실패했습니다.");
      }
    } finally {
      setBulkBusy(false);
    }
  }

  function startEdit(asset: Asset) {
    setForm({
      asset_type: asset.asset_type, asset_name: asset.asset_name, manufacturer: asset.manufacturer,
      model: asset.model, serial_number: asset.serial_number, ip_address: asset.ip_address,
      asset_tag: asset.asset_tag, status: asset.status, os: asset.os,
      access_ip: asset.access_ip, user_name: asset.user_name, admin_name: asset.admin_name,
      network_zone: asset.network_zone || "",
      cia_c: asset.cia_c == null ? "" : String(asset.cia_c),
      cia_i: asset.cia_i == null ? "" : String(asset.cia_i),
      cia_a: asset.cia_a == null ? "" : String(asset.cia_a),
      department: asset.department, purchase_date: asset.purchase_date, warranty_date: asset.warranty_date,
      eos_date: asset.eos_date, rack_id: asset.rack_id, rack_unit_start: asset.rack_unit_start,
      rack_unit_size: asset.rack_unit_size, rack_side: asset.rack_side ?? null, description: asset.description,
    });

    setCustomValues(cvMap[asset.id] || {});
    setEditId(asset.id);
    setShowForm(true);
  }

  // --- 커스텀 필드 관리 함수 ---
  async function addCustomField() {
    if (!fieldForm.field_key || !fieldForm.field_label) return;
    const res = await fetch("/api/custom-fields", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fieldForm),
    });
    if (res.ok) {
      const data = await res.json();
      setCustomFields((prev) => [...prev, data]);
      resetFieldForm();
    }
  }

  async function saveCustomField() {
    if (!editFieldId || !fieldForm.field_label) return;
    const res = await fetch(`/api/custom-fields/${editFieldId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fieldForm),
    });
    if (res.ok) {
      const data = await res.json();
      setCustomFields((prev) => prev.map((f) => (f.id === editFieldId ? { ...f, ...data } : f)));
      setEditFieldId(null);
      resetFieldForm();
    }
  }

  function startEditField(f: CustomField) {
    setEditFieldId(f.id);
    setFieldForm({
      field_key: f.field_key, field_label: f.field_label, field_type: f.field_type,
      field_group: f.field_group || "기본", options: f.options, asset_types: f.asset_types,
      is_required: f.is_required, show_in_table: f.show_in_table, show_in_detail: f.show_in_detail,
    });
  }

  function resetFieldForm() {
    setEditFieldId(null);
    setFieldForm({
      field_key: "", field_label: "", field_type: "text", field_group: "기본",
      options: "", asset_types: "", is_required: 0, show_in_table: 0, show_in_detail: 1,
    });
  }

  async function deleteCustomField(id: number) {
    if (!confirm("이 사용자 정의 필드를 비활성화하시겠습니까?\n\n자동 처리: 목록·입력 폼에서 숨겨집니다(이미 입력된 값은 삭제되지 않음).")) return;
    const res = await fetch(`/api/custom-fields/${id}`, { method: "DELETE" });
    if (res.ok) {
      setCustomFields((prev) => prev.filter((f) => f.id !== id));
      if (editFieldId === id) resetFieldForm();
    }
  }

  // 커스텀 필드 값 렌더링
  function renderCustomValue(f: CustomField, value: string | undefined) {
    if (!value) return "-";
    if (f.field_type === "multi-text") {
      try {
        const arr = JSON.parse(value);
        return Array.isArray(arr) ? arr.join(", ") : value;
      } catch { return value; }
    }
    return value;
  }

  // 커스텀 필드 입력 렌더링
  function renderCustomInput(f: CustomField) {
    const val = customValues[f.id] || "";
    if (f.field_type === "select") {
      return (
        <select value={val} onChange={(e) => setCustomValues({ ...customValues, [f.id]: e.target.value })} className="form-input">
          <option value="">선택</option>
          {f.options.split(",").map((opt: string) => <option key={opt.trim()} value={opt.trim()}>{opt.trim()}</option>)}
        </select>
      );
    }
    if (f.field_type === "textarea") {
      return <textarea value={val} onChange={(e) => setCustomValues({ ...customValues, [f.id]: e.target.value })} className="form-input" rows={2} />;
    }
    if (f.field_type === "multi-text") {
      let items: string[] = [];
      try { items = val ? JSON.parse(val) : []; } catch { items = val ? [val] : []; }
      return (
        <div className="space-y-1">
          {items.map((item, i) => (
            <div key={i} className="flex gap-1">
              <input value={item} onChange={(e) => {
                const newItems = [...items]; newItems[i] = e.target.value;
                setCustomValues({ ...customValues, [f.id]: JSON.stringify(newItems) });
              }} className="form-input flex-1" />
              <button type="button" onClick={() => {
                const newItems = items.filter((_, j) => j !== i);
                setCustomValues({ ...customValues, [f.id]: JSON.stringify(newItems) });
              }} className="text-ink-3 hover:text-fault px-1"><X size={14} /></button>
            </div>
          ))}
          <button type="button" onClick={() => {
            setCustomValues({ ...customValues, [f.id]: JSON.stringify([...items, ""]) });
          }} className="text-xs text-ink-2 hover:text-ink">+ 추가</button>
        </div>
      );
    }
    return (
      <input
        type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
        value={val}
        onChange={(e) => setCustomValues({ ...customValues, [f.id]: e.target.value })}
        className="form-input"
      />
    );
  }

  return (
    <div>
      {/* 작성 중이던 폼 복구 제안 (외부 검토 P0 합의: 세션 만료/이탈로 인한 입력 유실 복구) */}
      {draft && !showForm && (
        <div className="flex items-center gap-2 px-4 py-2 mb-4 rounded-lg bg-amber-50 border border-warn/30 text-sm text-warn">
          <AlertCircle size={15} className="shrink-0" />
          <span>저장되지 않은 작성 중 폼이 있습니다{draft.form.asset_name ? ` — '${draft.form.asset_name}'` : ""}.</span>
          <button
            className="underline font-medium hover:text-ink"
            onClick={() => { setForm({ ...emptyAsset, ...draft.form }); setEditId(draft.editId); setShowForm(true); setDraft(null); }}
          >이어서 작성</button>
          <button className="text-ink-3 hover:text-ink underline" onClick={clearDraft}>버리기</button>
        </div>
      )}
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input type="text" placeholder="이름, IP, 제조사, OS, 관리자, 부서 검색..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="form-input w-full pl-9" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="form-input">
          <option value="">전체 유형</option>
          {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={rackFilter} onChange={(e) => setRackFilter(e.target.value)}
          className="form-input">
          <option value="">전체 랙</option>
          {racks.map((r: any) => <option key={r.id} value={r.id}>{r.rack_name} ({r.location_name})</option>)}
        </select>
        <select value={missingFilter} onChange={(e) => setMissingFilter(e.target.value)}
          className={`form-input ${missingFilter ? "ring-1 ring-warn" : ""}`} title="라이프사이클 정비 대상 필터">
          <option value="">정비 대상</option>
          <option value="rack">랙 미실장</option>
          <option value="ip">IP 미부여</option>
        </select>
        <button onClick={() => (allExpanded ? collapseAllTypes() : expandAllTypes())}
          className="flex items-center gap-1.5 border border-line px-3 py-2 rounded-lg text-sm hover:bg-slate-100 text-ink-2"
          title="유형 그룹 전체 펼치기/접기">
          {allExpanded ? <ChevronRight size={16} /> : <ChevronDown size={16} />} {allExpanded ? "모두 접기" : "모두 펼치기"}
        </button>
        <button onClick={() => { setShowForm(true); setEditId(null); setForm({ ...emptyAsset, ...lastAssetCommon }); setCustomValues({}); }}
          className="btn-ink flex items-center gap-1.5">
          <Plus size={16} /> 자산 등록
        </button>
        <button onClick={() => setShowFieldManager(!showFieldManager)}
          className="flex items-center gap-1.5 border border-line px-3 py-2 rounded-lg text-sm hover:bg-slate-100 text-ink-2">
          <Settings size={16} /> 확장필드
        </button>
        <button onClick={() => { setShowBulkImport(true); setImportResult(null); }}
          className="flex items-center gap-1.5 border border-line px-3 py-2 rounded-lg text-sm hover:bg-slate-100 text-ink-2">
          <Upload size={16} /> 일괄등록
        </button>
        <a href="/api/assets/export"
          className="flex items-center gap-1.5 border border-line px-3 py-2 rounded-lg text-sm hover:bg-slate-100 text-ink-2">
          <Download size={16} /> 내보내기
        </a>
        <a href="/api/assets/ledger"
          className="flex items-center gap-1.5 border border-line px-3 py-2 rounded-lg text-sm hover:bg-slate-100 text-ink-2">
          <FileSpreadsheet size={16} /> 관리대장(제출용)
        </a>
      </div>

      {/* 사용 가이드 (접기/펼치기) */}
      <UsageGuide
        className="mb-4 text-right"
        items={[
          <>자산은 <strong className="text-ink-2">소속 팀 기준</strong>으로 보입니다 — 다른 팀 자산은 보이지 않습니다(총괄·열람자 제외)</>,
          <>개별 등록 외에 <strong className="text-ink-2">양식 다운로드 → 엑셀 작성 → 가져오기</strong>로 대량 등록할 수 있습니다</>,
          <><strong className="text-ink-2">정비 대상</strong> 필터로 랙 미실장·IP 미부여 자산만 모아 볼 수 있습니다</>,
          <>행을 클릭하면 상세·변경이력이 펼쳐집니다</>,
          <>체크박스로 여러 건 선택 후 <strong className="text-ink-2">일괄 수정·삭제</strong>가 가능합니다</>,
        ]}
      />

      {/* 확장필드 관리 */}
      {showFieldManager && (
        <div className="panel p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-ink">확장 필드 관리</h3>
            <button onClick={() => setShowFieldManager(false)} className="text-ink-3 hover:text-ink"><X size={16} /></button>
          </div>
          <p className="text-xs text-ink-3 mb-3">자산에 추가할 속성을 정의합니다. 그룹별로 폼에 섹션이 생기고, 테이블표시를 켜면 목록에 컬럼이 추가됩니다.</p>

          {customFields.length > 0 && (
            <div className="mb-4 space-y-1">
              {customFields.map((f) => (
                editFieldId === f.id ? (
                  <div key={f.id} className="grid grid-cols-2 md:grid-cols-9 gap-1.5 bg-slate-100 rounded px-3 py-2 items-center text-xs">
                    <input value={fieldForm.field_key} disabled className="form-input text-xs bg-slate-100" title="키는 변경 불가" />
                    <input value={fieldForm.field_label} onChange={(e) => setFieldForm({ ...fieldForm, field_label: e.target.value })} className="form-input text-xs" placeholder="라벨" />
                    <select value={fieldForm.field_type} onChange={(e) => setFieldForm({ ...fieldForm, field_type: e.target.value })} className="form-input text-xs">
                      <option value="text">텍스트</option><option value="number">숫자</option><option value="date">날짜</option>
                      <option value="select">선택</option><option value="textarea">텍스트영역</option><option value="multi-text">다중값</option>
                    </select>
                    <input value={fieldForm.field_group} onChange={(e) => setFieldForm({ ...fieldForm, field_group: e.target.value })} className="form-input text-xs" placeholder="그룹" />
                    <input value={fieldForm.options} onChange={(e) => setFieldForm({ ...fieldForm, options: e.target.value })} className="form-input text-xs" placeholder="옵션(콤마)" />
                    <input value={fieldForm.asset_types} onChange={(e) => setFieldForm({ ...fieldForm, asset_types: e.target.value })} className="form-input text-xs" placeholder="유형필터" />
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!fieldForm.show_in_table} onChange={(e) => setFieldForm({ ...fieldForm, show_in_table: e.target.checked ? 1 : 0 })} /> 테이블</label>
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!fieldForm.is_required} onChange={(e) => setFieldForm({ ...fieldForm, is_required: e.target.checked ? 1 : 0 })} /> 필수</label>
                    <div className="flex gap-1">
                      <button onClick={saveCustomField} className="bg-ink hover:bg-rail text-white rounded text-xs px-2 py-1">저장</button>
                      <button onClick={resetFieldForm} className="border border-line rounded text-xs px-2 py-1">취소</button>
                    </div>
                  </div>
                ) : (
                  <div key={f.id} className="flex items-center justify-between bg-panel border border-line rounded px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{f.field_label}</span>
                      <span className="text-ink-3 text-xs">({f.field_key})</span>
                      <span className="text-xs px-1.5 py-0.5 bg-slate-100 rounded">{f.field_type}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-ink rounded">{f.field_group}</span>
                      {f.show_in_table ? <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-ink rounded">테이블</span> : null}
                      {f.is_required ? <span className="text-xs px-1.5 py-0.5 bg-red-50 text-fault rounded">필수</span> : null}
                      {f.asset_types && <span className="text-xs text-ink-3">{f.asset_types}</span>}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => startEditField(f)} className="text-ink-2 hover:text-ink hover:bg-slate-100 rounded p-1"><Pencil size={14} /></button>
                      <button onClick={() => deleteCustomField(f.id)} className="text-fault hover:bg-red-50 rounded p-1"><Trash2 size={14} /></button>
                    </div>
                  </div>
                )
              ))}
            </div>
          )}

          {!editFieldId && (
            <div className="grid grid-cols-2 md:grid-cols-9 gap-1.5 text-xs">
              <input placeholder="키(영문)" value={fieldForm.field_key} onChange={(e) => setFieldForm({ ...fieldForm, field_key: e.target.value })} className="form-input text-xs" />
              <input placeholder="라벨" value={fieldForm.field_label} onChange={(e) => setFieldForm({ ...fieldForm, field_label: e.target.value })} className="form-input text-xs" />
              <select value={fieldForm.field_type} onChange={(e) => setFieldForm({ ...fieldForm, field_type: e.target.value })} className="form-input text-xs">
                <option value="text">텍스트</option><option value="number">숫자</option><option value="date">날짜</option>
                <option value="select">선택</option><option value="textarea">텍스트영역</option><option value="multi-text">다중값</option>
              </select>
              <input placeholder="그룹명" value={fieldForm.field_group} onChange={(e) => setFieldForm({ ...fieldForm, field_group: e.target.value })} className="form-input text-xs" />
              <input placeholder="옵션(콤마)" value={fieldForm.options} onChange={(e) => setFieldForm({ ...fieldForm, options: e.target.value })} className="form-input text-xs" />
              <input placeholder="유형필터" value={fieldForm.asset_types} onChange={(e) => setFieldForm({ ...fieldForm, asset_types: e.target.value })} className="form-input text-xs" />
              <label className="flex items-center gap-1"><input type="checkbox" checked={!!fieldForm.show_in_table} onChange={(e) => setFieldForm({ ...fieldForm, show_in_table: e.target.checked ? 1 : 0 })} /> 테이블</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={!!fieldForm.is_required} onChange={(e) => setFieldForm({ ...fieldForm, is_required: e.target.checked ? 1 : 0 })} /> 필수</label>
              <button onClick={addCustomField} className="bg-ink hover:bg-rail text-white rounded text-xs py-1.5">추가</button>
            </div>
          )}
        </div>
      )}

      {/* 일괄등록 */}
      {showBulkImport && (
        <div className="panel p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2"><FileSpreadsheet size={18} /> 자산 일괄등록</h3>
            <button onClick={() => setShowBulkImport(false)} className="text-ink-3 hover:text-ink"><X size={18} /></button>
          </div>
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-slate-100 rounded-lg">
              <span className="num bg-ink text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">1</span>
              <div>
                <p className="text-sm font-medium">양식 다운로드</p>
                <p className="text-xs text-ink-3 mt-1">엑셀 양식을 다운로드하여 자산 정보를 입력합니다.</p>
                <a href="/api/assets/template" className="inline-flex items-center gap-1.5 mt-2 bg-ink hover:bg-rail text-white px-3 py-1.5 rounded text-xs">
                  <Download size={14} /> 양식 다운로드 (.xlsx)
                </a>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-slate-100 rounded-lg">
              <span className="num bg-ink text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">2</span>
              <div className="flex-1">
                <p className="text-sm font-medium">양식 업로드</p>
                <p className="text-xs text-ink-3 mt-1">작성한 엑셀 파일을 드래그하거나 클릭하여 업로드하면 자동으로 자산이 등록됩니다.</p>
                <label
                  onDragOver={(e) => { e.preventDefault(); if (!importing) setDragOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
                  onDrop={(e) => {
                    e.preventDefault(); setDragOver(false);
                    if (importing) return;
                    handleImportFile(e.dataTransfer.files?.[0]);
                  }}
                  className={`mt-2 flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-lg px-4 py-6 text-center cursor-pointer transition-colors ${dragOver ? "border-ink bg-slate-200" : "border-line bg-panel hover:bg-slate-100"} ${importing ? "opacity-60 pointer-events-none" : ""}`}
                >
                  <Upload size={20} className="text-ink-3" />
                  <span className="text-sm text-ink-2">파일을 여기로 드래그하거나 <span className="text-ink font-medium underline">클릭하여 선택</span></span>
                  <span className="text-xs text-ink-3">지원 형식: .xlsx, .xls</span>
                  <input type="file" accept=".xlsx,.xls" disabled={importing} className="hidden"
                    onChange={(e) => { handleImportFile(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                {importing && <p className="text-xs text-ink-2 mt-2">업로드 중...</p>}
              </div>
            </div>
            {importResult && (
              <div className={`p-4 rounded-lg ${importResult.error ? "bg-red-50 border border-fault/30" : importResult.preview ? "bg-amber-50 border border-warn/30" : "bg-green-50 border border-signal/30"}`}>
                <div className="flex items-center gap-2 mb-2">
                  {importResult.error ? <AlertCircle size={16} className="text-fault" /> : <FileSpreadsheet size={16} className={importResult.preview ? "text-warn" : "text-signal"} />}
                  <span className="font-medium text-sm">
                    {importResult.error
                      ? importResult.error
                      : importResult.preview
                        ? `검증 결과(반영 전): 생성 예정 ${importResult.would_create ?? 0}건 / 총 ${importResult.totalRows ?? 0}행`
                        : `${importResult.imported ?? 0}건 등록 / 총 ${importResult.totalRows ?? 0}행${importResult.duration_ms != null ? ` · ${(importResult.duration_ms / 1000).toFixed(1)}초` : ""}`}
                  </span>
                </div>
                {!importResult.error && importResult.issues && (
                  <>
                    {/* 결과 요약 카드: 오류/식별자없음/OS미입력/중복의심 */}
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      {[
                        { label: "오류(IP)", n: importResult.issues.ip_format ?? 0 },
                        { label: "식별자 없음", n: importResult.issues.missing_id ?? 0 },
                        { label: "OS 미입력", n: importResult.issues.missing_os ?? 0 },
                        { label: "중복 의심", n: importResult.issues.dup_suspect ?? 0 },
                      ].map((c) => (
                        <div key={c.label} className="rounded border border-line bg-white/60 px-2 py-1.5 text-center">
                          <div className={`num text-lg font-bold ${c.n > 0 ? "text-warn" : "text-ink-3"}`}>{c.n}</div>
                          <div className="text-[0.625rem] text-ink-3">{c.label}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[0.6875rem] text-ink-3 mb-1">malformed 값은 운영 컬럼에 적재되지 않고 정리 큐(import_issue)로 보존됩니다.</p>
                    {Array.isArray(importResult.issueRows) && importResult.issueRows.length > 0 && (
                      <table className="w-full text-xs mt-1"><thead><tr className="text-left text-ink-3 border-b border-line">
                        <th className="pb-1 pr-2">행</th><th className="pb-1 pr-2">유형</th><th className="pb-1 pr-2">원본값</th><th className="pb-1">비고</th>
                      </tr></thead><tbody>
                        {importResult.issueRows.slice(0, 100).map((it: any, i: number) => (
                          <tr key={i} className="border-b border-line last:border-0">
                            <td className="py-1 pr-2 text-ink-3 num">{it.source_row ?? "-"}</td>
                            <td className="py-1 pr-2 font-medium text-warn">{it.issue_type}</td>
                            <td className="py-1 pr-2 text-ink-3 truncate max-w-[150px]">{it.raw_value || "-"}</td>
                            <td className="py-1 text-ink-3">{it.note}</td>
                          </tr>
                        ))}
                      </tbody></table>
                    )}
                  </>
                )}
                {/* 프리뷰 단계: 기존 대장과 중복 의심 + 실행/취소 */}
                {importResult.preview && (
                  <>
                    {Array.isArray(importResult.dup_existing) && importResult.dup_existing.length > 0 && (
                      <div className="mt-2 mb-2">
                        <p className="text-xs font-medium text-warn mb-1">기존 대장과 중복 의심 {importResult.dup_existing.length}건 — 그대로 반영하면 별도 자산으로 추가 생성됩니다</p>
                        <table className="w-full text-xs"><thead><tr className="text-left text-ink-3 border-b border-line">
                          <th className="pb-1 pr-2">행</th><th className="pb-1 pr-2">이름</th><th className="pb-1">사유</th>
                        </tr></thead><tbody>
                          {importResult.dup_existing.slice(0, 30).map((d: any, i: number) => (
                            <tr key={i} className="border-b border-line last:border-0">
                              <td className="py-1 pr-2 num text-ink-3">{d.source_row}</td>
                              <td className="py-1 pr-2">{d.name}</td>
                              <td className="py-1 text-ink-3">{d.reason}</td>
                            </tr>
                          ))}
                        </tbody></table>
                      </div>
                    )}
                    <div className="flex gap-2 mt-2">
                      <button onClick={confirmImport} disabled={importing} className="btn-ink px-4 py-1.5 text-sm disabled:opacity-50">
                        {importing ? "반영 중..." : `가져오기 실행 (${importResult.would_create ?? 0}건 생성)`}
                      </button>
                      <button onClick={() => { setImportResult(null); setPendingImportFile(null); }} className="px-4 py-1.5 text-sm rounded border border-line text-ink-2 hover:bg-slate-100">
                        취소
                      </button>
                    </div>
                    <p className="text-[0.6875rem] text-ink-3 mt-1.5">아직 반영되지 않았습니다. 중복 의심 건은 엑셀에서 정리 후 다시 올리거나, 그대로 실행 후 정리큐에서 처리할 수 있습니다.</p>
                  </>
                )}
                {/* 실반영 완료: 생성 목록 다운로드 + 배치 롤백(admin) */}
                {!importResult.error && !importResult.preview && importResult.batch_id && (
                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-line">
                    <span className="text-[0.6875rem] text-ink-3 num">배치 {importResult.batch_id}</span>
                    {Array.isArray(importResult.created) && importResult.created.length > 0 && (
                      <button onClick={downloadCreatedCsv} className="text-xs px-2.5 py-1 rounded border border-line text-ink-2 hover:bg-slate-100 inline-flex items-center gap-1">
                        <Download size={12} /> 생성 목록 CSV ({importResult.created.length}건)
                      </button>
                    )}
                    {isAdmin && (
                      <button onClick={() => rollbackImportBatch(importResult.batch_id, importResult.imported ?? 0)}
                        className="text-xs px-2.5 py-1 rounded border border-fault/40 text-fault hover:bg-red-50">
                        이 배치 되돌리기
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 등록/수정 폼 */}
      {showForm && (
        <div className="panel p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-ink">{editId ? "자산 수정" : "자산 등록"}</h3>
            <button onClick={() => { setShowForm(false); setEditId(null); clearDraft(); }} className="text-ink-3 hover:text-ink"><X size={18} /></button>
          </div>

          {/* 기본 정보 */}
          <h4 className="eyebrow block mb-2">기본 정보</h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <FormField label="유형 *">
              {/* 독립 부서 직접 입력 허용: 표준 6종 + “직접 입력”. 표준이 아닌 값(자체 유형)이면 텍스트 입력 노출. */}
              <select
                value={typeLabels[form.asset_type] ? form.asset_type : "__custom__"}
                onChange={(e) => setForm({ ...form, asset_type: e.target.value === "__custom__" ? "" : e.target.value })}
                className="form-input"
              >
                {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                <option value="__custom__">직접 입력…</option>
              </select>
              {!typeLabels[form.asset_type] && (
                <input
                  value={form.asset_type}
                  onChange={(e) => setForm({ ...form, asset_type: e.target.value })}
                  className="form-input mt-1"
                  maxLength={30}
                  placeholder="유형 직접 입력 (예: 스토리지)"
                />
              )}
            </FormField>
            <FormField label="이름 *"><input value={form.asset_name} onChange={(e) => setForm({ ...form, asset_name: e.target.value })} className="form-input" /></FormField>

            <FormField label="제조사"><input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} className="form-input" /></FormField>
            <FormField label="모델"><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="form-input" /></FormField>
            <FormField label="시리얼"><input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} className="form-input" /></FormField>
            <FormField label="IP 주소"><input value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} className="form-input" placeholder="대표 IP" /></FormField>
            <FormField label="자산태그"><input value={form.asset_tag} onChange={(e) => setForm({ ...form, asset_tag: e.target.value })} className="form-input" /></FormField>
            <FormField label="상태">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="form-input">
                {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </FormField>
            <FormField label="망구분">
              {/* 독립 부서 자체 망 명칭 직접 입력 허용: 표준 2종은 datalist 추천, 그 외 자유 입력. */}
              <input
                list="zone-presets"
                value={form.network_zone}
                onChange={(e) => setForm({ ...form, network_zone: e.target.value })}
                className="form-input"
                maxLength={30}
                placeholder="미지정 (직접 입력 가능)"
              />
              <datalist id="zone-presets">
                {Object.keys(zoneLabels).map((z) => <option key={z} value={z} />)}
              </datalist>
            </FormField>
          </div>

          {/* 운영 정보 */}
          <h4 className="eyebrow block mb-2">운영 정보</h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <FormField label="OS / 펌웨어"><input value={form.os} onChange={(e) => setForm({ ...form, os: e.target.value })} className="form-input" /></FormField>
            <FormField label="접근 IP"><textarea value={form.access_ip} onChange={(e) => setForm({ ...form, access_ip: e.target.value })} className="form-input" rows={2} placeholder="여러 개면 줄바꿈/콤마로 구분" title="접근 IP가 여럿이면 줄바꿈 또는 콤마(,)로 구분해 입력하세요." /></FormField>
            <FormField label="사용자"><input value={form.user_name} onChange={(e) => setForm({ ...form, user_name: e.target.value })} className="form-input" /></FormField>
            <FormField label="관리자"><input value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} className="form-input" /></FormField>
            <FormField label="부서 (읽기전용·레거시)"><input value={form.department} readOnly disabled className="form-input bg-slate-50 text-ink-3 cursor-not-allowed" title="부서는 레거시 음영 컬럼입니다. 소유는 팀(team)으로 관리됩니다." /></FormField>
            <FormField label="기밀성(C)">
              <select value={form.cia_c} onChange={(e) => setForm({ ...form, cia_c: e.target.value })} className="form-input">
                <option value="">-</option><option value="1">1 (Low)</option><option value="2">2 (Medium)</option><option value="3">3 (High)</option>
              </select>
            </FormField>
            <FormField label="무결성(I)">
              <select value={form.cia_i} onChange={(e) => setForm({ ...form, cia_i: e.target.value })} className="form-input">
                <option value="">-</option><option value="1">1 (Low)</option><option value="2">2 (Medium)</option><option value="3">3 (High)</option>
              </select>
            </FormField>
            <FormField label="가용성(A)">
              <select value={form.cia_a} onChange={(e) => setForm({ ...form, cia_a: e.target.value })} className="form-input">
                <option value="">-</option><option value="1">1 (Low)</option><option value="2">2 (Medium)</option><option value="3">3 (High)</option>
              </select>
            </FormField>
            <FormField label="설명"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="form-input" /></FormField>
          </div>

          {/* 랙 배치 */}
          <h4 className="eyebrow block mb-2">랙 배치</h4>
          {(() => {
            const selectedRack = racks.find((r: any) => r.id === form.rack_id);
            const maxU = selectedRack?.total_units ?? 42;
            const maxStart = Math.max(1, maxU - (form.rack_unit_size ?? 1) + 1);
            const maxSize = form.rack_unit_start ? Math.max(1, maxU - form.rack_unit_start + 1) : maxU;
            return (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                <FormField label="설치 랙">
                  <select value={form.rack_id ?? ""} onChange={(e) => setForm({ ...form, rack_id: e.target.value ? Number(e.target.value) : null, rack_unit_start: null, rack_unit_size: 1, rack_side: null })} className="form-input">
                    <option value="">미설치</option>
                    {racks.map((r: any) => <option key={r.id} value={r.id}>{r.rack_name} ({r.location_name}) — {r.total_units}U</option>)}

                  </select>
                </FormField>
                <FormField label={`시작 U${selectedRack ? ` (1~${maxStart})` : ""}`}>
                  <input type="number" min={1} max={maxStart} value={form.rack_unit_start ?? ""} disabled={!form.rack_id}
                    onChange={(e) => setForm({ ...form, rack_unit_start: e.target.value ? Math.min(Math.max(1, Number(e.target.value)), maxStart) : null })}
                    className="form-input" placeholder={form.rack_id ? `1~${maxStart}` : "랙 선택"} />
                </FormField>
                <FormField label={`크기 U${selectedRack ? ` (1~${maxSize})` : ""}`}>
                  <input type="number" min={1} max={maxSize} value={form.rack_unit_size} disabled={!form.rack_id}
                    onChange={(e) => setForm({ ...form, rack_unit_size: Math.min(Math.max(1, Number(e.target.value) || 1), maxSize) })}
                    className="form-input" placeholder={form.rack_id ? `1~${maxSize}` : "랙 선택"} />
                </FormField>
                <FormField label="반폭 배치">
                  <select value={form.rack_side ?? ""} disabled={!form.rack_id}
                    onChange={(e) => setForm({ ...form, rack_side: e.target.value === "L" || e.target.value === "R" ? e.target.value : null })}
                    className="form-input" title="하프폭 장비를 같은 U의 좌/우에 나란히 배치할 때 지정합니다. 전폭은 해당 U 전체를 점유합니다.">
                    <option value="">전폭 (기본)</option>
                    <option value="L">좌 (L)</option>
                    <option value="R">우 (R)</option>
                  </select>
                </FormField>
              </div>
            );
          })()}
          {/* 날짜 / 계약 */}
          <h4 className="eyebrow block mb-2">날짜 / 계약</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <FormField label="구매일"><input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} className="form-input" /></FormField>
            <FormField label="보증만료"><input type="date" value={form.warranty_date} onChange={(e) => setForm({ ...form, warranty_date: e.target.value })} className="form-input" /></FormField>
            <FormField label="EoS 일자"><input type="date" value={form.eos_date} onChange={(e) => setForm({ ...form, eos_date: e.target.value })} className="form-input" /></FormField>
          </div>


          {/* 커스텀 필드 — 그룹별 섹션 */}
          {(() => {
            const groups = getFieldsByGroup(form.asset_type);
            const groupNames = Object.keys(groups);
            if (groupNames.length === 0) return null;
            return groupNames.map((groupName) => (
              <div key={groupName}>
                <h4 className="eyebrow block mb-2">{groupName}</h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                  {groups[groupName].map((f) => (
                    <FormField key={f.id} label={`${f.field_label}${f.is_required ? " *" : ""}`}>
                      {renderCustomInput(f)}
                    </FormField>
                  ))}
                </div>
              </div>
            ));
          })()}

          <div className="flex gap-2">
            <button onClick={handleSave} className="btn-ink flex items-center gap-1.5">
              <Save size={16} /> {editId ? "수정" : "등록"}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null); clearDraft(); }} className="px-4 py-2 border border-line rounded-lg text-sm hover:bg-slate-100">취소</button>
          </div>
        </div>
      )}

      {/* 검색결과 일괄수정 바 — 행 선택 시 노출 */}
      {selectedVisibleIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-3 rounded-lg border border-ink/30 bg-surface">
          <span className="text-sm font-semibold text-ink">선택 <span className="num">{selectedVisibleIds.length}</span>건 일괄수정</span>
          <select value={bulkField} onChange={(e) => { setBulkField(e.target.value as BulkField); setBulkValue(""); }} className="form-input">
            {isAdmin && <option value="team_id">관리부서</option>}
            <option value="user_name">사용자</option>
            <option value="admin_name">관리자</option>
            <option value="cia_c">기밀성(C)</option>
            <option value="cia_i">무결성(I)</option>
            <option value="cia_a">가용성(A)</option>
            <option value="status">상태</option>
            <option value="network_zone">망구분</option>
          </select>
          {(bulkField === "admin_name" || bulkField === "user_name") ? (
            <input type="text" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
              placeholder="값 입력 (비우면 삭제)" maxLength={100} className="form-input" />
          ) : bulkField === "network_zone" ? (
            <>
              <input type="text" list="zone-presets-bulk" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                placeholder="미지정 (직접 입력 가능)" maxLength={30} className="form-input" />
              <datalist id="zone-presets-bulk">
                <option value="업무망" />
                <option value="인터넷망" />
              </datalist>
            </>
          ) : (
            <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} className="form-input">
              {bulkField === "status" && (
                <>
                  <option value="">상태 선택</option>
                  {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </>
              )}
              {(bulkField === "cia_c" || bulkField === "cia_i" || bulkField === "cia_a") && (
                <>
                  <option value="">미지정</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </>
              )}
              {bulkField === "team_id" && (
                <>
                  <option value="">미지정</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.team_name}</option>)}
                </>
              )}
            </select>
          )}
          <button onClick={handleBulkApply} disabled={bulkBusy}
            className="btn-ink flex items-center gap-1.5 disabled:opacity-50">
            <Save size={16} /> {bulkBusy ? "적용 중..." : "적용"}
          </button>
          <button onClick={handleBulkDelete} disabled={bulkBusy}
            className="flex items-center gap-1.5 border border-fault/40 text-fault px-3 py-2 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50">
            <Trash2 size={16} /> {bulkBusy ? "처리 중..." : "선택 삭제"}
          </button>
          <button onClick={clearSelection}
            className="px-3 py-2 border border-line rounded-lg text-sm hover:bg-slate-100 text-ink-2">선택 해제</button>
        </div>
      )}

      {/* 테이블 */}
      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 1200 }}>
            <thead>
              <tr className="bg-surface border-b border-line text-left text-ink-2">
                <th className="p-3 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                    aria-label="검색결과 전체 선택" title="검색결과 전체 선택" />
                </th>
                <th className="p-3 w-8"></th>
                <th className="p-3">유형</th>
                <th className="p-3">망구분</th>
                <th className="p-3">이름</th>
                <th className="p-3">제조사/모델</th>
                <th className="p-3">IP</th>
                <th className="p-3">관리부서</th>
                {tableCustomFields.map((f) => <th key={f.id} className="p-3 text-xs">{f.field_label}</th>)}
                <th className="p-3">위치</th>
                <th className="p-3">상태</th>
                <th className="p-3 w-28">관리</th>
              </tr>
            </thead>
            <tbody>
              {assetGroups.map(([type, items]) => {
                const open = expandedTypes.has(type) || isFiltering;
                return (
                  <Fragment key={type}>
                    <tr className="bg-surface/60 border-b border-line">
                      <td colSpan={groupColSpan} className="p-0">
                        <button onClick={() => toggleType(type)}
                          className="w-full flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold text-ink hover:bg-slate-100">
                          {open ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
                          <span>{typeLabels[type] || type}</span>
                          <span className="num text-xs text-ink-3">{items.length}개</span>
                        </button>
                      </td>
                    </tr>
                    {open && (uncappedTypes.has(type) ? items : items.slice(0, RENDER_CAP)).map((a) => (
                      <TableRow key={a.id} asset={a} expanded={expandedId === a.id}
                        selected={selectedIds.has(a.id)} onSelect={() => toggleSelect(a.id)}
                        onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
                        onEdit={() => startEdit(a)} onDelete={() => handleDelete(a.id)}
                        tableCustomFields={tableCustomFields} allCustomFields={customFields}
                        cvMap={cvMap} renderCustomValue={renderCustomValue}
                        getFieldsForType={getFieldsForType} />
                    ))}
                    {/* 대규모 렌더 안전장치 (가격심의 갭 2 대응): 그룹당 200행 초과분은 요청 시 렌더 —
                        1만대급에서도 브라우저가 죽지 않는 체감 상한. 검색/필터는 전체 데이터 대상 그대로. */}
                    {open && items.length > RENDER_CAP && !uncappedTypes.has(type) && (
                      <tr>
                        <td colSpan={groupColSpan} className="p-0">
                          <button
                            onClick={() => setUncappedTypes((prev) => new Set(prev).add(type))}
                            className="w-full py-2 text-xs text-signal hover:bg-slate-50"
                          >
                            나머지 {items.length - RENDER_CAP}건 더 표시 (성능 보호를 위해 {RENDER_CAP}건씩 렌더)
                          </button>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={groupColSpan} className="p-8 text-center text-ink-3">{assets.length === 0 && !isFiltering ? "아직 등록된 자산이 없습니다. 자산 등록 버튼으로 개별 등록하거나, 양식을 내려받아 엑셀로 일괄 등록하세요." : "등록된 자산이 없습니다."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line p-3 text-xs text-ink-3">총 <span className="num">{filtered.length}</span>건</div>
      </div>

    </div>
  );
}

// --- 테이블 행 ---
function TableRow({ asset: a, expanded, selected, onSelect, onToggle, onEdit, onDelete,
  tableCustomFields, allCustomFields, cvMap, renderCustomValue, getFieldsForType,
}: {
  asset: Asset; expanded: boolean; selected: boolean; onSelect: () => void; onToggle: () => void; onEdit: () => void; onDelete: () => void;
  tableCustomFields: CustomField[]; allCustomFields: CustomField[];
  cvMap: Record<number, Record<number, string>>;
  renderCustomValue: (f: CustomField, v: string | undefined) => string;
  getFieldsForType: (t: string) => CustomField[];
}) {
  return (
    <>
      <tr className="border-b border-line last:border-0 hover-row cursor-pointer" onClick={onToggle}>
        <td className="p-3" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={onSelect} aria-label="자산 선택" />
        </td>
        <td className="p-3 text-ink-3">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
        <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded ${typeColors[a.asset_type] || typeColors.other}`}>{typeLabels[a.asset_type] || a.asset_type}</span></td>
        <td className="p-3 text-xs text-ink-3">{a.network_zone ? (zoneLabels[a.network_zone] || a.network_zone) : "-"}</td>
        <td className="p-3 font-medium">{a.asset_name}</td>
        <td className="p-3 text-ink-3 text-xs">{a.manufacturer} {a.model}</td>
        <td className="p-3 text-xs text-ink-3">
          {a.ip_address ? (
            <span className="num">{a.ip_address}</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-ink-3" title="IP 미부여 — 정비 대상 필터에서 모아볼 수 있습니다">미부여</span>
          )}
        </td>
        <td className="p-3 text-xs text-ink-3">{a.team_name || "-"}</td>
        {tableCustomFields.map((f) => (
          <td key={f.id} className="p-3 text-xs text-ink-3">{renderCustomValue(f, cvMap[a.id]?.[f.id])}</td>
        ))}
        <td className="p-3 text-xs text-ink-3">{a.rack_name ? <>{a.location_name}/{a.rack_name} (<span className="num">{a.rack_unit_start}</span>U)</> : "-"}</td>
        <td className="p-3"><span className={`inline-flex items-center gap-1.5 text-xs font-medium ${statusColors[a.status] || "text-idle"}`}><span className={`led ${statusLed[a.status] || "led-idle"}`} />{statusLabels[a.status]}</span></td>
        <td className="p-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-0.5">
            <button onClick={onEdit} className="p-1.5 text-ink-2 hover:text-ink hover:bg-slate-100 rounded" title="수정"><Pencil size={14} /></button>
            <button onClick={onDelete} className="p-1.5 text-fault hover:bg-red-50 rounded" title="삭제"><Trash2 size={14} /></button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-surface border-b border-line">
          <td colSpan={11 + tableCustomFields.length} className="p-4">
            {/* 기본 상세 */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs mb-4">
              <DetailItem label="시리얼" value={a.serial_number} />
              <DetailItem label="자산태그" value={a.asset_tag} />
              <div>
                <span className="text-ink-3">접근 IP</span>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {(() => {
                    const ips = splitAccessIps(a.access_ip);
                    return ips.length
                      ? ips.map((ip) => <span key={ip} className="font-medium text-ink rounded bg-slate-100 px-1.5 py-0.5">{ip}</span>)
                      : <span className="font-medium text-ink">-</span>;
                  })()}
                </div>
              </div>
              <DetailItem label="사용자" value={a.user_name} />
              <DetailItem label="설명" value={a.description} />
              <DetailItem label="구매일" value={a.purchase_date} />
              <DetailItem label="보증만료" value={a.warranty_date} />
              <DetailItem label="EoS" value={a.eos_date} />
              <DetailItem label="OS" value={a.os} />
              <DetailItem label="관리자" value={a.admin_name} />
              <DetailItem label="기밀성(C)" value={a.cia_c != null ? String(a.cia_c) : ""} />
              <DetailItem label="무결성(I)" value={a.cia_i != null ? String(a.cia_i) : ""} />
              <DetailItem label="가용성(A)" value={a.cia_a != null ? String(a.cia_a) : ""} />
              <DetailItem label="보안등급" value={a.cia_grade ? `${a.cia_grade} (합계 ${a.cia_total})` : ""} />
            </div>
            {/* 커스텀 필드 상세 — 그룹별 */}
            {(() => {
              const fields = getFieldsForType(a.asset_type).filter((f: CustomField) => f.show_in_detail);
              if (fields.length === 0) return null;
              const groups: Record<string, CustomField[]> = {};
              for (const f of fields) { const g = f.field_group || "기본"; if (!groups[g]) groups[g] = []; groups[g].push(f); }
              return Object.entries(groups).map(([g, fs]) => (
                <div key={g} className="mb-3">
                  <h5 className="eyebrow block mb-1">{g}</h5>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
                    {fs.map((f: CustomField) => <DetailItem key={f.id} label={f.field_label} value={renderCustomValue(f, cvMap[a.id]?.[f.id])} />)}
                  </div>
                </div>
              ));
            })()}
            {/* 변경이력 */}
            <div className="mt-3">
              <ExpandSection title="변경이력" icon={<History size={14} />} assetId={a.id} />
          </div>
          </td>
        </tr>
      )}
    </>
  );
}

// --- 변경이력 lazy load (+ '더 보기' 페이지 로드 — 외부 검토 R4-1 합의) ---
function ExpandSection({ title, icon, assetId }: { title: string; icon: React.ReactNode; assetId: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  async function fetchPage(offset: number) {
    const res = await fetch(`/api/assets/${assetId}/logs?limit=20&offset=${offset}`);
    if (!res.ok) return null;
    const d = await res.json();
    // 신응답 {rows,total} / 구형 배열 모두 호환
    return Array.isArray(d) ? { rows: d, total: d.length } : { rows: d.rows ?? [], total: d.total ?? 0 };
  }

  async function load() {
    if (data !== null) { setOpen(!open); return; }
    const page = await fetchPage(0);
    if (page) { setData(page.rows); setTotal(page.total); }
    setOpen(true);
  }

  async function loadMore() {
    if (!data) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(data.length);
      if (page) { setData([...data, ...page.rows]); setTotal(page.total); }
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <button onClick={load} className="flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink mb-2">
        {icon} {title} {open ? "▲" : "▼"}
      </button>
      {open && data && (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {data.length === 0 && <p className="text-xs text-ink-3">변경 이력 없음</p>}
          {data.map((log: any) => (
            <div key={log.id} className="flex items-start gap-2 text-xs">
              <span className="num text-ink-3 shrink-0 w-32">{log.created_at}</span>
              <span className="font-medium shrink-0">{log.changed_by || "-"}</span>
              <span className={`shrink-0 px-1.5 py-0.5 rounded ${
                log.action === "create" ? "bg-green-50 text-signal" :
                log.action === "update" ? "bg-slate-100 text-ink" : "bg-red-50 text-fault"
              }`}>{log.action === "create" ? "등록" : log.action === "update" ? "수정" : "삭제"}</span>
              {log.action === "update" && (
                <span className="text-ink-3 truncate">
                  {Array.isArray(log.changed_fields)
                    ? log.changed_fields.join(", ")
                    : (() => { try { return JSON.parse(log.changed_fields).join(", "); } catch { return ""; } })()}
                </span>
              )}
            </div>
          ))}
          {data.length < total && (
            <button onClick={loadMore} disabled={loadingMore}
              className="w-full text-center text-xs text-signal hover:underline py-1 disabled:opacity-50">
              {loadingMore ? "불러오는 중..." : `더 보기 (${data.length}/${total})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}


function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-ink-2 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

// 값 없음은 '-' 대신 '미입력'으로 명시 (외부 검토 P1-1 합의: 공백이 '원래 없음'인지 '아직 안 채움'인지 구분).
// missingHint=false 인 항목(예: 사용자가 없을 수 있는 필드)은 기존 '-' 유지.
function DetailItem({ label, value, missingHint = true }: { label: string; value?: string; missingHint?: boolean }) {
  return (
    <div>
      <span className="text-ink-3">{label}</span>
      {value ? (
        <p className="font-medium text-ink mt-0.5">{value}</p>
      ) : (
        <p className="mt-0.5 text-[11px] text-ink-3">{missingHint ? "미입력" : "-"}</p>
      )}
    </div>
  );
}

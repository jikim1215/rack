"use client";

import { useState } from "react";
import { FileText, Building2, Plus, Pencil, Trash2 } from "lucide-react";

interface Vendor {
  id: number;
  vendor_name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  business_number: string;
  vendor_type: string;
  notes: string;
}

interface Contract {
  id: number;
  vendor_id: number | null;
  vendor_name: string | null;
  contract_name: string;
  contract_type: string;
  start_date: string;
  end_date: string;
  amount: string;
  auto_renew: number;
  status: string;
  notes: string;
}

const contractTypeBadge: Record<string, { label: string; cls: string }> = {
  maintenance: { label: "유지보수", cls: "bg-slate-100 text-ink" },
  purchase: { label: "구매", cls: "bg-slate-100 text-ink" },
  lease: { label: "임대", cls: "bg-slate-100 text-ink" },
  other: { label: "기타", cls: "bg-slate-100 text-ink" },
};

const statusLabels: Record<string, string> = {
  active: "유효",
  expired: "만료",
  cancelled: "해지",
};

const vendorTypeLabels: Record<string, string> = {
  maintenance: "유지보수",
  supplier: "공급업체",
  other: "기타",
};

function daysUntil(dateStr: string): number {
  if (!dateStr) return Infinity;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

const emptyContract = {
  vendor_id: "",
  contract_name: "",
  contract_type: "maintenance",
  start_date: "",
  end_date: "",
  amount: "",
  auto_renew: false,
  notes: "",
};

const emptyVendor = {
  vendor_name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  business_number: "",
  vendor_type: "maintenance",
  notes: "",
};

export default function ContractsView({
  vendors: initVendors,
  contracts: initContracts,
}: {
  vendors: Vendor[];
  contracts: Contract[];
}) {
  const [tab, setTab] = useState<"contracts" | "vendors">("contracts");
  const [vendors, setVendors] = useState(initVendors);
  const [contracts, setContracts] = useState(initContracts);

  // Contract form
  const [cForm, setCForm] = useState(emptyContract);
  const [cFormOpen, setCFormOpen] = useState(false);

  // Vendor form
  const [vForm, setVForm] = useState(emptyVendor);
  const [vFormOpen, setVFormOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);

  // --- Contracts ---
  const totalContracts = contracts.length;
  const activeContracts = contracts.filter((c) => c.status === "active").length;
  const expiredContracts = contracts.filter((c) => c.status === "expired").length;
  const expiringSoon = contracts.filter(
    (c) => c.status === "active" && daysUntil(c.end_date) <= 30 && daysUntil(c.end_date) > 0
  ).length;

  async function handleAddContract(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...cForm, vendor_id: cForm.vendor_id ? Number(cForm.vendor_id) : null }),
    });
    if (res.ok) {
      const c = await res.json();
      setContracts([...contracts, c]);
      setCForm(emptyContract);
      setCFormOpen(false);
    }
  }

  async function handleDeleteContract(id: number) {
    if (!confirm("이 계약을 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/contracts/${id}`, { method: "DELETE" });
    if (res.ok) setContracts(contracts.filter((c) => c.id !== id));
  }

  // --- Vendors ---
  async function handleAddVendor(e: React.FormEvent) {
    e.preventDefault();
    if (editingVendor) {
      const res = await fetch(`/api/vendors/${editingVendor.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vForm),
      });
      if (res.ok) {
        const v = await res.json();
        setVendors(vendors.map((x) => (x.id === v.id ? v : x)));
        setVForm(emptyVendor);
        setVFormOpen(false);
        setEditingVendor(null);
      }
    } else {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vForm),
      });
      if (res.ok) {
        const v = await res.json();
        setVendors([...vendors, v]);
        setVForm(emptyVendor);
        setVFormOpen(false);
      }
    }
  }

  async function handleDeactivateVendor(id: number) {
    if (!confirm("이 업체를 비활성화하시겠습니까?")) return;
    const res = await fetch(`/api/vendors/${id}`, { method: "DELETE" });
    if (res.ok) setVendors(vendors.filter((v) => v.id !== id));
  }

  function startEditVendor(v: Vendor) {
    setEditingVendor(v);
    setVForm({
      vendor_name: v.vendor_name,
      contact_person: v.contact_person,
      phone: v.phone,
      email: v.email,
      address: v.address,
      business_number: v.business_number,
      vendor_type: v.vendor_type,
      notes: v.notes,
    });
    setVFormOpen(true);
  }

  function contractRowClass(c: Contract) {
    if (c.status === "expired" || daysUntil(c.end_date) <= 0) return "bg-red-50";
    if (c.status === "active" && daysUntil(c.end_date) <= 30) return "bg-yellow-50";
    return "";
  }

  const inputCls = "form-input w-full text-sm";
  const btnPrimary = "btn-ink px-4 py-1.5 rounded text-sm flex items-center gap-1";

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="eyebrow">CONTRACT</p>
          <h2 className="text-2xl font-bold tracking-tight">계약관리</h2>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line mb-6">
        <button
          onClick={() => setTab("contracts")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "contracts" ? "border-signal text-ink" : "border-transparent text-ink-2 hover:text-ink"
          }`}
        >
          <span className="flex items-center gap-1.5"><FileText size={16} /> 계약 관리</span>
        </button>
        <button
          onClick={() => setTab("vendors")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "vendors" ? "border-signal text-ink" : "border-transparent text-ink-2 hover:text-ink"
          }`}
        >
          <span className="flex items-center gap-1.5"><Building2 size={16} /> 업체 관리</span>
        </button>
      </div>

      {tab === "contracts" && (
        <div>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: "전체", value: totalContracts, led: "led-idle", valCls: "" },
              { label: "유효", value: activeContracts, led: "led-up", valCls: "text-signal" },
              { label: "만료", value: expiredContracts, led: "led-fault", valCls: "text-fault" },
              { label: "만료임박(30일)", value: expiringSoon, led: "led-warn", valCls: "text-warn" },
            ].map((s) => (
              <div key={s.label} className="panel p-4">
                <p className="eyebrow flex items-center gap-1.5">
                  <span className={`led ${s.led}`} />{s.label}
                </p>
                <p className={`text-2xl font-bold num ${s.valCls}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Add Contract Button */}
          <div className="flex justify-end mb-4">
            <button onClick={() => setCFormOpen(!cFormOpen)} className={btnPrimary}>
              <Plus size={16} /> 계약 등록
            </button>
          </div>

          {/* Contract Form */}
          {cFormOpen && (
            <form onSubmit={handleAddContract} className="panel p-4 mb-6 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">업체</label>
                <select
                  value={cForm.vendor_id}
                  onChange={(e) => setCForm({ ...cForm, vendor_id: e.target.value })}
                  className={inputCls}
                >
                  <option value="">선택</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.vendor_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">계약명 *</label>
                <input
                  required
                  value={cForm.contract_name}
                  onChange={(e) => setCForm({ ...cForm, contract_name: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">유형</label>
                <select
                  value={cForm.contract_type}
                  onChange={(e) => setCForm({ ...cForm, contract_type: e.target.value })}
                  className={inputCls}
                >
                  <option value="maintenance">유지보수</option>
                  <option value="purchase">구매</option>
                  <option value="lease">임대</option>
                  <option value="other">기타</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">시작일</label>
                <input
                  type="date"
                  value={cForm.start_date}
                  onChange={(e) => setCForm({ ...cForm, start_date: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">종료일</label>
                <input
                  type="date"
                  value={cForm.end_date}
                  onChange={(e) => setCForm({ ...cForm, end_date: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">금액</label>
                <input
                  value={cForm.amount}
                  onChange={(e) => setCForm({ ...cForm, amount: e.target.value })}
                  placeholder="예: 12,000,000"
                  className={inputCls}
                />
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cForm.auto_renew as boolean}
                    onChange={(e) => setCForm({ ...cForm, auto_renew: e.target.checked })}
                  />
                  자동갱신
                </label>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">비고</label>
                <input
                  value={cForm.notes}
                  onChange={(e) => setCForm({ ...cForm, notes: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="col-span-2 flex justify-end gap-2">
                <button type="button" onClick={() => setCFormOpen(false)} className="px-4 py-1.5 text-sm border border-line rounded text-ink-2 hover:text-ink hover:bg-slate-100">
                  취소
                </button>
                <button type="submit" className={btnPrimary}>등록</button>
              </div>
            </form>
          )}

          {/* Contract Table */}
          <div className="panel overflow-hidden">
            <table className="w-full text-sm">
              <thead className="panel-head border-b border-line">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">계약명</th>
                  <th className="text-left px-4 py-2 font-medium">업체명</th>
                  <th className="text-left px-4 py-2 font-medium">유형</th>
                  <th className="text-left px-4 py-2 font-medium">기간</th>
                  <th className="text-left px-4 py-2 font-medium">금액</th>
                  <th className="text-left px-4 py-2 font-medium">상태</th>
                  <th className="text-left px-4 py-2 font-medium">자동갱신</th>
                  <th className="text-left px-4 py-2 font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {contracts.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-ink-3">등록된 계약이 없습니다</td></tr>
                ) : (
                  contracts.map((c) => {
                    const badge = contractTypeBadge[c.contract_type] || contractTypeBadge.other;
                    const d = daysUntil(c.end_date);
                    const ddayFault = c.status === "expired" || d <= 30;
                    return (
                      <tr key={c.id} className={`border-b border-line hover:bg-slate-100 ${contractRowClass(c)}`}>
                        <td className="px-4 py-2 font-medium">{c.contract_name}</td>
                        <td className="px-4 py-2">{c.vendor_name || "-"}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                        </td>
                        <td className="px-4 py-2 text-xs num">{c.start_date} ~ {c.end_date}</td>
                        <td className="px-4 py-2 num">{c.amount || "-"}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs font-medium inline-flex items-center gap-1.5 ${
                            c.status === "active" ? "text-signal" : c.status === "expired" ? "text-fault" : "text-fault"
                          }`}>
                            <span className={`led ${
                              c.status === "active" ? "led-up" : "led-fault"
                            }`} />
                            {statusLabels[c.status] || c.status}
                          </span>
                          {c.status === "active" && d <= 30 && (
                            <span className={`ml-2 px-1.5 py-0.5 rounded text-xs num ${
                              ddayFault ? "bg-red-50 text-fault" : "bg-amber-50 text-warn"
                            }`}>
                              {d <= 0 ? "만료" : `D-${d}`}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">{c.auto_renew ? "✓" : "-"}</td>
                        <td className="px-4 py-2">
                          <button onClick={() => handleDeleteContract(c.id)} className="text-fault hover:bg-red-50 rounded p-1" title="삭제">
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "vendors" && (
        <div>
          {/* Add Vendor Button */}
          <div className="flex justify-end mb-4">
            <button
              onClick={() => {
                setEditingVendor(null);
                setVForm(emptyVendor);
                setVFormOpen(!vFormOpen);
              }}
              className={btnPrimary}
            >
              <Plus size={16} /> 업체 등록
            </button>
          </div>

          {/* Vendor Form */}
          {vFormOpen && (
            <form onSubmit={handleAddVendor} className="panel p-4 mb-6 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">업체명 *</label>
                <input
                  required
                  value={vForm.vendor_name}
                  onChange={(e) => setVForm({ ...vForm, vendor_name: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">담당자</label>
                <input
                  value={vForm.contact_person}
                  onChange={(e) => setVForm({ ...vForm, contact_person: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">전화</label>
                <input
                  value={vForm.phone}
                  onChange={(e) => setVForm({ ...vForm, phone: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">이메일</label>
                <input
                  type="email"
                  value={vForm.email}
                  onChange={(e) => setVForm({ ...vForm, email: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">주소</label>
                <input
                  value={vForm.address}
                  onChange={(e) => setVForm({ ...vForm, address: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">사업자번호</label>
                <input
                  value={vForm.business_number}
                  onChange={(e) => setVForm({ ...vForm, business_number: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">유형</label>
                <select
                  value={vForm.vendor_type}
                  onChange={(e) => setVForm({ ...vForm, vendor_type: e.target.value })}
                  className={inputCls}
                >
                  <option value="maintenance">유지보수</option>
                  <option value="supplier">공급업체</option>
                  <option value="other">기타</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">비고</label>
                <input
                  value={vForm.notes}
                  onChange={(e) => setVForm({ ...vForm, notes: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div className="col-span-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setVFormOpen(false); setEditingVendor(null); }}
                  className="px-4 py-1.5 text-sm border border-line rounded text-ink-2 hover:text-ink hover:bg-slate-100"
                >
                  취소
                </button>
                <button type="submit" className={btnPrimary}>
                  {editingVendor ? "수정" : "등록"}
                </button>
              </div>
            </form>
          )}

          {/* Vendor Table */}
          <div className="panel overflow-hidden">
            <table className="w-full text-sm">
              <thead className="panel-head border-b border-line">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">업체명</th>
                  <th className="text-left px-4 py-2 font-medium">담당자</th>
                  <th className="text-left px-4 py-2 font-medium">전화</th>
                  <th className="text-left px-4 py-2 font-medium">이메일</th>
                  <th className="text-left px-4 py-2 font-medium">유형</th>
                  <th className="text-left px-4 py-2 font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {vendors.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-ink-3">등록된 업체가 없습니다</td></tr>
                ) : (
                  vendors.map((v) => (
                    <tr key={v.id} className="border-b border-line hover:bg-slate-100">
                      <td className="px-4 py-2 font-medium">{v.vendor_name}</td>
                      <td className="px-4 py-2">{v.contact_person || "-"}</td>
                      <td className="px-4 py-2 num">{v.phone || "-"}</td>
                      <td className="px-4 py-2">{v.email || "-"}</td>
                      <td className="px-4 py-2">{vendorTypeLabels[v.vendor_type] || v.vendor_type}</td>
                      <td className="px-4 py-2 flex gap-2">
                        <button onClick={() => startEditVendor(v)} className="text-ink-2 hover:text-ink hover:bg-slate-100 rounded p-1" title="수정">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => handleDeactivateVendor(v.id)} className="text-fault hover:bg-red-50 rounded p-1" title="비활성화">
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

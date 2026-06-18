"use client";

import { useState, useMemo } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  RotateCcw,
  Plus,
  Check,
  X,
} from "lucide-react";

interface Movement {
  id: number;
  asset_id: number | null;
  asset_name: string | null;
  movement_type: string;
  movement_date: string;
  requester: string;
  approver: string;
  department: string;
  purpose: string;
  destination: string;
  equipment_desc: string;
  serial_number: string;
  status: string;
  notes: string;
  created_by: string;
  created_at: string;
}

interface Asset {
  id: number;
  asset_name: string;
  serial_number: string;
}

const typeLabels: Record<string, string> = {
  bring_in: "반입",
  bring_out: "반출",
  return: "반납",
};

const typeColors: Record<string, string> = {
  bring_in: "bg-blue-100 text-blue-700",
  bring_out: "bg-orange-100 text-orange-700",
  return: "bg-green-100 text-green-700",
};

const typeIcons: Record<string, typeof ArrowDownToLine> = {
  bring_in: ArrowDownToLine,
  bring_out: ArrowUpFromLine,
  return: RotateCcw,
};

const statusLabels: Record<string, string> = {
  requested: "신청",
  approved: "승인",
  completed: "완료",
  rejected: "반려",
};

const statusColors: Record<string, string> = {
  requested: "bg-slate-100 text-slate-700",
  approved: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export default function MovementsView({
  movements: initialMovements,
  assets,
}: {
  movements: Movement[];
  assets: Asset[];
}) {
  const [movements, setMovements] = useState<Movement[]>(initialMovements);
  const [showForm, setShowForm] = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // form state
  const [formType, setFormType] = useState("bring_in");
  const [formAssetId, setFormAssetId] = useState<string>("");
  const [formEquipDesc, setFormEquipDesc] = useState("");
  const [formSerial, setFormSerial] = useState("");
  const [formDate, setFormDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [formRequester, setFormRequester] = useState("");
  const [formDept, setFormDept] = useState("");
  const [formPurpose, setFormPurpose] = useState("");
  const [formDestination, setFormDestination] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const isManualEntry = formAssetId === "manual";

  const filtered = useMemo(() => {
    return movements.filter((m) => {
      if (filterType !== "all" && m.movement_type !== filterType) return false;
      if (filterStatus !== "all" && m.status !== filterStatus) return false;
      if (filterFrom && m.movement_date < filterFrom) return false;
      if (filterTo && m.movement_date > filterTo) return false;
      return true;
    });
  }, [movements, filterType, filterStatus, filterFrom, filterTo]);

  const stats = useMemo(() => {
    const bringIn = movements.filter(
      (m) => m.movement_type === "bring_in"
    ).length;
    const bringOut = movements.filter(
      (m) => m.movement_type === "bring_out"
    ).length;
    const unreturned = movements.filter(
      (m) => m.movement_type === "bring_out" && m.status !== "completed"
    ).length;
    return { bringIn, bringOut, unreturned };
  }, [movements]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        movement_type: formType,
        movement_date: formDate,
        asset_id: isManualEntry || !formAssetId ? null : Number(formAssetId),
        requester: formRequester,
        department: formDept,
        purpose: formPurpose,
        destination: formDestination,
        equipment_desc: isManualEntry ? formEquipDesc : "",
        serial_number: isManualEntry ? formSerial : "",
        notes: formNotes,
      };

      const res = await fetch("/api/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("저장 실패");
      const created = await res.json();
      setMovements((prev) => [created, ...prev]);
      resetForm();
      setShowForm(false);
    } catch {
      alert("저장에 실패했습니다");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setFormType("bring_in");
    setFormAssetId("");
    setFormEquipDesc("");
    setFormSerial("");
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormRequester("");
    setFormDept("");
    setFormPurpose("");
    setFormDestination("");
    setFormNotes("");
  }

  async function updateStatus(id: number, status: string) {
    const res = await fetch(`/api/movements/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "처리 실패");
      return;
    }
    const updated = await res.json();
    setMovements((prev) => prev.map((m) => (m.id === id ? updated : m)));
  }

  async function handleDelete(id: number) {
    if (!confirm("삭제하시겠습니까?")) return;
    const res = await fetch(`/api/movements/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setMovements((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <div className="space-y-6">
      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
            <ArrowDownToLine className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">반입</p>
            <p className="text-2xl font-bold">{stats.bringIn}건</p>
          </div>
        </div>
        <div className="bg-white rounded-lg border p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
            <ArrowUpFromLine className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">반출</p>
            <p className="text-2xl font-bold">{stats.bringOut}건</p>
          </div>
        </div>
        <div className="bg-white rounded-lg border p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
            <RotateCcw className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">미반납</p>
            <p className="text-2xl font-bold">{stats.unreturned}건</p>
          </div>
        </div>
      </div>

      {/* 필터 + 신청 버튼 */}
      <div className="bg-white rounded-lg border p-5">
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              유형
            </label>
            <select
              className="form-input"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="all">전체</option>
              <option value="bring_in">반입</option>
              <option value="bring_out">반출</option>
              <option value="return">반납</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              상태
            </label>
            <select
              className="form-input"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">전체</option>
              <option value="requested">신청</option>
              <option value="approved">승인</option>
              <option value="completed">완료</option>
              <option value="rejected">반려</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              시작일
            </label>
            <input
              type="date"
              className="form-input"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              종료일
            </label>
            <input
              type="date"
              className="form-input"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
            />
          </div>
          <div className="ml-auto">
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              반입/반출 신청
            </button>
          </div>
        </div>

        {/* 신청 폼 */}
        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="border-t pt-4 mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                유형 *
              </label>
              <select
                className="form-input"
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                required
              >
                <option value="bring_in">반입</option>
                <option value="bring_out">반출</option>
                <option value="return">반납</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                자산 선택
              </label>
              <select
                className="form-input"
                value={formAssetId}
                onChange={(e) => setFormAssetId(e.target.value)}
              >
                <option value="">-- 선택 --</option>
                <option value="manual">직접입력</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.asset_name}
                    {a.serial_number ? ` (${a.serial_number})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {isManualEntry && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    장비설명
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={formEquipDesc}
                    onChange={(e) => setFormEquipDesc(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    시리얼번호
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={formSerial}
                    onChange={(e) => setFormSerial(e.target.value)}
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                일자 *
              </label>
              <input
                type="date"
                className="form-input"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                신청자
              </label>
              <input
                type="text"
                className="form-input"
                value={formRequester}
                onChange={(e) => setFormRequester(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                부서
              </label>
              <input
                type="text"
                className="form-input"
                value={formDept}
                onChange={(e) => setFormDept(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                사유
              </label>
              <input
                type="text"
                className="form-input"
                value={formPurpose}
                onChange={(e) => setFormPurpose(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                목적지/출처
              </label>
              <input
                type="text"
                className="form-input"
                value={formDestination}
                onChange={(e) => setFormDestination(e.target.value)}
              />
            </div>

            <div className="md:col-span-2 lg:col-span-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                비고
              </label>
              <textarea
                className="form-input"
                rows={2}
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </div>

            <div className="md:col-span-2 lg:col-span-3 flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50"
              >
                {saving ? "저장 중..." : "신청하기"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
              >
                취소
              </button>
            </div>
          </form>
        )}
      </div>

      {/* 목록 테이블 */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-3 font-medium text-gray-600">
                  유형
                </th>
                <th className="text-left p-3 font-medium text-gray-600">
                  자산/장비
                </th>
                <th className="text-left p-3 font-medium text-gray-600">
                  일자
                </th>
                <th className="text-left p-3 font-medium text-gray-600">
                  신청자
                </th>
                <th className="text-left p-3 font-medium text-gray-600">
                  부서
                </th>
                <th className="text-left p-3 font-medium text-gray-600">
                  사유
                </th>
                <th className="text-left p-3 font-medium text-gray-600">
                  상태
                </th>
                <th className="text-left p-3 font-medium text-gray-600">
                  관리
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-400">
                    데이터가 없습니다
                  </td>
                </tr>
              ) : (
                filtered.map((m) => {
                  const Icon = typeIcons[m.movement_type] || ArrowDownToLine;
                  return (
                    <tr key={m.id} className="border-b hover-row">
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${typeColors[m.movement_type] || ""}`}
                        >
                          <Icon className="w-3 h-3" />
                          {typeLabels[m.movement_type] || m.movement_type}
                        </span>
                      </td>
                      <td className="p-3">
                        {m.asset_name || m.equipment_desc || "-"}
                      </td>
                      <td className="p-3 text-gray-500">{m.movement_date}</td>
                      <td className="p-3">{m.requester}</td>
                      <td className="p-3">{m.department}</td>
                      <td className="p-3 text-gray-600 max-w-[200px] truncate">
                        {m.purpose}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[m.status] || ""}`}
                        >
                          {statusLabels[m.status] || m.status}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          {m.status === "requested" && (
                            <>
                              <button
                                onClick={() =>
                                  updateStatus(m.id, "approved")
                                }
                                className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                                title="승인"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() =>
                                  updateStatus(m.id, "rejected")
                                }
                                className="p-1 text-red-600 hover:bg-red-50 rounded"
                                title="반려"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {m.status === "approved" && (
                            <button
                              onClick={() =>
                                updateStatus(m.id, "completed")
                              }
                              className="px-2 py-1 text-xs bg-green-50 text-green-700 hover:bg-green-100 rounded"
                            >
                              완료
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(m.id)}
                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="삭제"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

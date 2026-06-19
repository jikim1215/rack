"use client";

import { X } from "lucide-react";

interface AuditLog {
  id: number;
  entity_type: string;
  entity_id: number;
  entity_name: string;
  action: string;
  changed_by: string;
  changed_fields: string[];
  old_values: Record<string, any>;
  new_values: Record<string, any>;
  created_at: string;
}

interface Props {
  logs: AuditLog[];
  title: string;
  onClose: () => void;
}

const actionLabels: Record<string, { text: string; cls: string; led: string }> = {
  create: { text: "생성", cls: "bg-green-50 text-signal", led: "led-up" },
  update: { text: "수정", cls: "bg-amber-50 text-warn", led: "led-warn" },
  delete: { text: "삭제", cls: "bg-red-50 text-fault", led: "led-fault" },
};

export function AuditLogModal({ logs, title, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={onClose}>
      <div className="bg-panel border border-line rounded-xl shadow-xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-ink">{title} 변경이력</h3>
          <button onClick={onClose} className="text-ink-2 hover:text-ink hover:bg-slate-100 rounded p-0.5"><X size={18} /></button>
        </div>

        {logs.length === 0 ? (
          <p className="text-sm text-ink-3 py-4 text-center">변경 이력이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => {
              const al = actionLabels[log.action] || { text: log.action, cls: "bg-slate-100 text-ink", led: "led-idle" };
              return (
                <div key={log.id} className="border-b border-line pb-2 last:border-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="num text-ink-3">{log.created_at}</span>
                    <span className="font-medium text-ink">{log.changed_by || "-"}</span>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${al.cls}`}><span className={`led ${al.led}`} />{al.text}</span>
                  </div>

                  {log.changed_fields?.length > 0 && (
                    <div className="mt-1 text-xs text-ink-2">
                      {log.changed_fields.map((f) => (
                        <span key={f} className="inline-block bg-slate-100 rounded px-1 mr-1">{f}</span>
                      ))}
                    </div>
                  )}

                  {/* update: old → new diff */}
                  {log.action === "update" && log.old_values && Object.keys(log.old_values).length > 0 && (
                    <div className="mt-1 text-xs space-y-0.5">
                      {Object.keys(log.old_values).map((k) => (
                        <div key={k}>
                          <span className="text-ink-3">{k}:</span>{" "}
                          <span className="num text-fault line-through">{String(log.old_values[k])}</span>{" → "}
                          <span className="num text-signal">{String(log.new_values?.[k] ?? "")}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* create: new values */}
                  {log.action === "create" && log.new_values && Object.keys(log.new_values).length > 0 && (
                    <div className="mt-1 text-xs space-y-0.5">
                      {Object.keys(log.new_values).map((k) => (
                        <div key={k}>
                          <span className="text-ink-3">{k}:</span>{" "}
                          <span className="num text-signal">{String(log.new_values[k])}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* delete: old values */}
                  {log.action === "delete" && log.old_values && Object.keys(log.old_values).length > 0 && (
                    <div className="mt-1 text-xs space-y-0.5">
                      {Object.keys(log.old_values).map((k) => (
                        <div key={k}>
                          <span className="text-ink-3">{k}:</span>{" "}
                          <span className="num text-fault line-through">{String(log.old_values[k])}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** audit API 호출 유틸리티 */
export async function fetchAuditLogs(entityType: string, entityId: number, limit = 20): Promise<any[] | null> {
  try {
    const res = await fetch(`/api/audit?entity_type=${entityType}&entity_id=${entityId}&limit=${limit}`);
    if (res.ok) return await res.json();
    const data = await res.json().catch(() => ({}));
    alert(data.error || "이력 조회에 실패했습니다.");
    return null;
  } catch {
    alert("이력 조회 중 오류가 발생했습니다.");
    return null;
  }
}

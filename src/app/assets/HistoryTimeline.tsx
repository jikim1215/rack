"use client";

import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Clock } from "lucide-react";

interface FieldChange {
  field: string;
  old_value: string;
  new_value: string;
}

interface LogEntry {
  id: number;
  action: string;
  changed_by: string;
  changes: FieldChange[] | string | null;
  created_at: string;
}

const ACTION_CONFIG: Record<string, { icon: typeof Plus; color: string; label: string }> = {
  create: { icon: Plus, color: "text-green-500 bg-green-50", label: "등록" },
  update: { icon: Pencil, color: "text-blue-500 bg-blue-50", label: "수정" },
  delete: { icon: Trash2, color: "text-red-500 bg-red-50", label: "삭제" },
};

export default function HistoryTimeline({ assetId }: { assetId: number }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/assets/${assetId}/logs`);
        if (res.ok) {
          const data = await res.json();
          setLogs(Array.isArray(data) ? data.slice(0, 20) : []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [assetId]);

  if (loading) {
    return <div className="text-sm text-slate-400">로딩 중...</div>;
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-slate-400">
        <Clock className="w-10 h-10 mb-2" />
        <span className="text-sm">변경 이력이 없습니다</span>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-200" />

      <div className="space-y-4">
        {logs.map((log) => {
          const config = ACTION_CONFIG[log.action] ?? ACTION_CONFIG.update;
          const Icon = config.icon;
          const changes = parseChanges(log.changes);

          return (
            <div key={log.id} className="relative pl-10">
              {/* Icon dot */}
              <div
                className={`absolute left-2 top-0.5 w-5 h-5 rounded-full flex items-center justify-center ${config.color}`}
              >
                <Icon className="w-3 h-3" />
              </div>

              <div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>{formatDate(log.created_at)}</span>
                  <span className="font-medium text-slate-600">
                    {log.changed_by}
                  </span>
                  <span className="font-medium text-slate-500">
                    {config.label}
                  </span>
                </div>

                {log.action === "update" && changes.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex flex-wrap gap-1">
                      {changes.map((c, i) => (
                        <span
                          key={i}
                          className="bg-blue-100 text-blue-700 text-xs rounded px-1.5"
                        >
                          {c.field}
                        </span>
                      ))}
                    </div>
                    <div className="space-y-0.5">
                      {changes.map((c, i) => (
                        <div key={i} className="text-xs">
                          <span className="text-red-500 line-through">
                            {c.old_value || "(없음)"}
                          </span>
                          <span className="mx-1 text-slate-300">→</span>
                          <span className="text-green-600">
                            {c.new_value || "(없음)"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function parseChanges(raw: FieldChange[] | string | null): FieldChange[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

"use client";

import {
  useState,
  useEffect,
  createContext,
  useContext,
  useCallback,
} from "react";
import { CheckCircle, AlertCircle, X, ArrowRight } from "lucide-react";
import Link from "next/link";

export interface ToastAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
  action?: ToastAction;
}

const ToastContext = createContext<{
  addToast: (message: string, type?: Toast["type"], action?: ToastAction) => void;
}>({ addToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let toastId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    (message: string, type: Toast["type"] = "success", action?: ToastAction) => {
      const id = ++toastId;
      setToasts((prev) => [...prev, { id, message, type, action }]);
    },
    []
  );

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onRemove={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast;
  onRemove: () => void;
}) {
  useEffect(() => {
    // 액션(다음 단계 넛지)이 있으면 읽고 클릭할 시간을 더 준다
    const timer = setTimeout(onRemove, toast.action ? 7000 : 3000);
    return () => clearTimeout(timer);
  }, [onRemove, toast.action]);

  const iconMap = {
    success: <CheckCircle className="w-5 h-5 text-signal shrink-0" />,
    error: <AlertCircle className="w-5 h-5 text-fault shrink-0" />,
    info: <AlertCircle className="w-5 h-5 text-ink-2 shrink-0" />,
  };

  const accent = {
    success: "border-l-signal",
    error: "border-l-fault",
    info: "border-l-ink",
  };

  return (
    <div
      className={`bg-panel shadow-lg rounded-lg p-3 pl-4 flex items-center gap-2 min-w-64 border border-line border-l-[3px] ${accent[toast.type]} animate-slide-in`}
      style={{
        animation: "slide-in 0.2s ease-out",
      }}
    >
      <style>{`
        @keyframes slide-in {
          from { opacity: 0; transform: translateX(100%); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      {iconMap[toast.type]}
      <div className="flex-1">
        <span className="text-sm text-ink block">{toast.message}</span>
        {toast.action && (toast.action.href ? (
          <Link
            href={toast.action.href}
            onClick={onRemove}
            className="inline-flex items-center gap-1 text-xs font-medium text-signal hover:underline mt-1"
          >
            {toast.action.label} <ArrowRight className="w-3 h-3" />
          </Link>
        ) : (
          <button
            onClick={() => { toast.action?.onClick?.(); onRemove(); }}
            className="inline-flex items-center gap-1 text-xs font-medium text-signal hover:underline mt-1"
          >
            {toast.action.label} <ArrowRight className="w-3 h-3" />
          </button>
        ))}
      </div>
      <button
        onClick={onRemove}
        className="text-ink-3 hover:text-ink shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

"use client";

import {
  useState,
  useEffect,
  createContext,
  useContext,
  useCallback,
} from "react";
import { CheckCircle, AlertCircle, X } from "lucide-react";

interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

const ToastContext = createContext<{
  addToast: (message: string, type?: Toast["type"]) => void;
}>({ addToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let toastId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    (message: string, type: Toast["type"] = "success") => {
      const id = ++toastId;
      setToasts((prev) => [...prev, { id, message, type }]);
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
    const timer = setTimeout(onRemove, 3000);
    return () => clearTimeout(timer);
  }, [onRemove]);

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
      <span className="text-sm text-ink flex-1">{toast.message}</span>
      <button
        onClick={onRemove}
        className="text-ink-3 hover:text-ink shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

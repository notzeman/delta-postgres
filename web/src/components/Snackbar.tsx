import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from "lucide-react";

type Tone = "success" | "error" | "warning" | "info";

interface SnackbarItem {
  id: number;
  tone: Tone;
  message: React.ReactNode;
  text: string;
  duration: number;
}

interface SnackbarApi {
  show: (tone: Tone, message: React.ReactNode, duration?: number) => number;
  success: (message: React.ReactNode, duration?: number) => number;
  error: (message: React.ReactNode, duration?: number) => number;
  warning: (message: React.ReactNode, duration?: number) => number;
  info: (message: React.ReactNode, duration?: number) => number;
  dismiss: (id: number) => void;
}

const SnackbarContext = createContext<SnackbarApi | null>(null);

const TONE = {
  success: {
    icon: CheckCircle2,
    panel: "border-emerald-500/30 bg-emerald-500/10",
    iconClass: "text-emerald-400",
    bar: "bg-emerald-400",
    role: "status" as const,
  },
  error: {
    icon: XCircle,
    panel: "border-rose-500/30 bg-rose-500/10",
    iconClass: "text-rose-400",
    bar: "bg-rose-400",
    role: "alert" as const,
  },
  warning: {
    icon: AlertTriangle,
    panel: "border-amber-500/30 bg-amber-500/10",
    iconClass: "text-amber-400",
    bar: "bg-amber-400",
    role: "alert" as const,
  },
  info: {
    icon: Info,
    panel: "border-sky-500/30 bg-sky-500/10",
    iconClass: "text-sky-400",
    bar: "bg-sky-400",
    role: "status" as const,
  },
};

function textOf(message: React.ReactNode): string {
  if (typeof message === "string") return message;
  if (typeof message === "number") return String(message);
  return "";
}

function SnackbarCard({
  item,
  onClose,
}: {
  item: SnackbarItem;
  onClose: () => void;
}) {
  const tone = TONE[item.tone];
  const Icon = tone.icon;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const timer = window.setTimeout(() => closeRef.current(), item.duration);
    return () => window.clearTimeout(timer);
  }, [item.duration, item.id]);

  return (
    <div
      role={tone.role}
      className={`pointer-events-auto relative w-full overflow-hidden rounded-2xl border p-4 shadow-pop backdrop-blur-2xl [background-color:rgb(var(--glass-strong))] ${tone.panel}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tone.iconClass}`} />
        <div className="max-h-48 min-w-0 flex-1 overflow-y-auto pr-6 text-[13px] leading-relaxed text-slate-200">
          {item.message}
        </div>
        <button
          onClick={onClose}
          className="absolute right-2.5 top-2.5 rounded-lg p-1 text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
          aria-label="Dismiss notification"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/5">
        <div
          className={`h-full ${tone.bar}`}
          style={{
            animation: `snackbar-progress ${item.duration}ms linear forwards`,
          }}
        />
      </div>
    </div>
  );
}

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<SnackbarItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback(
    (tone: Tone, message: React.ReactNode, duration?: number) => {
      const text = textOf(message);
      const id = nextId.current++;
      const timeout =
        duration ?? (tone === "error" || tone === "warning" ? 8000 : 5000);
      setItems((current) => {
        if (text && current.some((item) => item.tone === tone && item.text === text)) {
          return current;
        }
        return [
          ...current.slice(-4),
          { id, tone, message, text, duration: timeout },
        ];
      });
      return id;
    },
    [],
  );

  const api: SnackbarApi = useMemo(
    () => ({
      show,
      success: (message, duration) => show("success", message, duration),
      error: (message, duration) => show("error", message, duration),
      warning: (message, duration) => show("warning", message, duration),
      info: (message, duration) => show("info", message, duration),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <SnackbarContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex flex-col items-end gap-2 p-4 sm:inset-x-auto sm:bottom-4 sm:right-4"
          aria-label="Notifications"
        >
          {items.map((item) => (
            <SnackbarCard
              key={item.id}
              item={item}
              onClose={() => dismiss(item.id)}
            />
          ))}
        </div>,
        document.body,
      )}
    </SnackbarContext.Provider>
  );
}

export function useSnackbar(): SnackbarApi {
  const api = useContext(SnackbarContext);
  if (!api) {
    throw new Error("useSnackbar must be used inside SnackbarProvider");
  }
  return api;
}

import React, { useEffect } from "react";
import { Loader2, X } from "lucide-react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("card", className)}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 px-5 py-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
}) {
  const variants: Record<ButtonVariant, string> = {
    primary: "btn-primary",
    secondary: "btn-secondary",
    danger: "btn-danger",
    ghost: "btn-ghost",
  };
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        variants[variant],
        size === "sm" && "px-2.5 py-1.5 text-xs",
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "green" | "red" | "amber" | "blue" | "neutral" | "violet";
  children: React.ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    green: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    red: "border-rose-500/25 bg-rose-500/10 text-rose-300",
    amber: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    blue: "border-sky-500/25 bg-sky-500/10 text-sky-300",
    violet: "border-violet-500/25 bg-violet-500/10 text-violet-300",
    neutral: "border-white/10 bg-white/5 text-slate-300",
  };
  return <span className={cn("chip", tones[tone], className)}>{children}</span>;
}

export function StatusBadge({ status }: { status?: string | null }) {
  const map: Record<string, { tone: any; label: string }> = {
    success: { tone: "green", label: "success" },
    running: { tone: "blue", label: "running" },
    queued: { tone: "amber", label: "queued" },
    failed: { tone: "red", label: "failed" },
    canceled: { tone: "neutral", label: "canceled" },
    stopped: { tone: "neutral", label: "stopped" },
    partial: { tone: "amber", label: "partial" },
    error: { tone: "red", label: "error" },
  };
  const entry = map[status || ""] || { tone: "neutral", label: status || "unknown" };
  return (
    <Badge tone={entry.tone}>
      {status === "running" || status === "queued" ? (
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" />
      ) : null}
      {entry.label}
    </Badge>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label || "Loading…"}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon ? <div className="mb-2 text-slate-500">{icon}</div> : null}
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {description ? <p className="max-w-sm text-xs text-slate-500">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8">
      <div
        className={cn(
          "card my-auto w-full overflow-hidden",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/5 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("input", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("input", props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("input", props.className)} />;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "default" | "accent" | "danger";
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
        {icon ? (
          <div
            className={cn(
              "rounded-lg border p-1.5",
              tone === "accent"
                ? "border-accent-500/20 bg-accent-500/10 text-accent-400"
                : tone === "danger"
                  ? "border-rose-500/20 bg-rose-500/10 text-rose-400"
                  : "border-white/10 bg-white/5 text-slate-400",
            )}
          >
            {icon}
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-100">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-white/5 bg-ink-900/60 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition",
            active === tab.id
              ? "bg-accent-500/15 text-accent-300"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
          )}
        >
          {tab.label}
          {typeof tab.count === "number" ? (
            <span className="ml-1.5 text-[10px] text-slate-500">{tab.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
      {message}
    </div>
  );
}

export function SuccessBox({ message }: { message: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
      {message}
    </div>
  );
}

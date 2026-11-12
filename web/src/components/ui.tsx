import React, { useEffect, useId } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { Check, Loader2, X } from "lucide-react";
import { useSnackbar } from "./Snackbar";

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
    <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-slate-100">{title}</h3>
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
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
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
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/60" />
      <div className="fixed inset-0 overflow-y-auto">
        <div className="flex min-h-full items-start justify-center p-4 sm:items-center sm:p-8">
          <DialogPanel
            className={cn(
              "popover w-full overflow-hidden rounded-xl",
              wide ? "max-w-3xl" : "max-w-lg",
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
              <div className="min-w-0">
                <DialogTitle className="text-base font-semibold text-slate-100">{title}</DialogTitle>
                {subtitle ? <p className="mt-0.5 text-[13px] text-slate-400">{subtitle}</p> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="btn-ghost -mr-1 p-1.5"
                aria-label="Close dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}

const LABELLABLE = new Set(["input", "textarea", "select"]);

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
  const generatedId = useId();
  let controlId: string | undefined;
  let control = children;
  if (React.isValidElement<{ id?: string }>(children)) {
    const type = children.type;
    const labellable =
      (typeof type === "string" && LABELLABLE.has(type)) || type === Input || type === Textarea;
    if (labellable) {
      controlId = children.props.id || generatedId;
      control = children.props.id ? children : React.cloneElement(children, { id: controlId });
    }
  }
  return (
    <div className={className}>
      <label className="label" htmlFor={controlId}>
        {label}
      </label>
      {control}
      {hint ? <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("input", props.className)} />;
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
      <div className="flex items-center gap-2 text-[13px] font-medium text-slate-400">
        {icon ? (
          <span
            className={cn(
              tone === "accent" ? "text-accent-400" : tone === "danger" ? "text-rose-400" : "text-slate-500",
            )}
          >
            {icon}
          </span>
        ) : null}
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton rounded-md", className)} />;
}

export function SkeletonRows({ rows = 4, label }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 px-5 py-4">
      <span className="sr-only">{label || "Loading"}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
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
    <div
      role="tablist"
      className="flex flex-wrap gap-1 rounded-lg border border-white/[0.07] bg-ink-900 p-1"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-[13px] font-medium transition",
            active === tab.id
              ? "bg-accent-500/15 text-accent-300"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
          )}
        >
          {tab.label}
          {typeof tab.count === "number" ? (
            <span className="num ml-1.5 text-[11px] text-slate-500">{tab.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  tone = "accent",
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  tone?: "accent" | "warning";
  className?: string;
}) {
  return (
    <label
      className={cn(
        "group flex cursor-pointer items-start gap-2.5 text-xs text-slate-300",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500/40",
          checked
            ? tone === "warning"
              ? "border-amber-400 bg-amber-400"
              : "border-accent-500 bg-accent-500"
            : "border-white/15 bg-ink-950/60 group-hover:border-white/30",
        )}
      >
        <Check
          className={cn(
            "h-3 w-3 text-ink-950 transition",
            checked ? "opacity-100" : "opacity-0",
          )}
          strokeWidth={3}
        />
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-slate-200">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "group flex cursor-pointer items-start gap-3 text-xs text-slate-300",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500/40",
          checked
            ? "border-accent-500 bg-accent-500"
            : "border-white/10 bg-white/5 group-hover:border-white/20",
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all",
            checked ? "left-6" : "left-1",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-slate-200">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function ErrorBox({ message }: { message: string }) {
  const snackbar = useSnackbar();
  useEffect(() => {
    if (message) snackbar.error(message);
  }, [message, snackbar]);
  return null;
}

export function SuccessBox({ message }: { message: string }) {
  const snackbar = useSnackbar();
  useEffect(() => {
    if (message) snackbar.success(message);
  }, [message, snackbar]);
  return null;
}

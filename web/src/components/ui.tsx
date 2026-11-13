import React, { useEffect, useId } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { Link } from "react-router-dom";
import { Check, ChevronLeft, Loader2, X } from "lucide-react";
import Tooltip from "./Tooltip";
import { useSnackbar } from "./Snackbar";
import { withViewTransition } from "./viewTransition";
import { useSlidingIndicator } from "./useSlidingIndicator";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cn("card", className)}>
      {children}
    </div>
  );
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
    <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-6 py-5">
      <div className="min-w-0">
        <h3 className="text-[17px] font-semibold text-slate-100">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p> : null}
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

/** Circular glass back button. Use it for every "up one level" link so back navigation looks the same everywhere. */
export function BackButton({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} viewTransition aria-label={label} title={label} className="back-btn group">
      <ChevronLeft
        className="h-5 w-5 transition-transform duration-200 group-hover:-translate-x-0.5"
        strokeWidth={2}
      />
    </Link>
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
    green: "chip-green text-emerald-300",
    red: "chip-red text-rose-300",
    amber: "chip-amber text-amber-300",
    blue: "chip-blue text-sky-300",
    violet: "chip-violet text-violet-300",
    neutral: "chip-neutral text-slate-300",
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

/**
 * Keeps a conditionally rendered modal mounted for `ms` after `open` turns false,
 * so its exit animation can finish before the parent unmounts it.
 */
export function useDelayedUnmount(open: boolean, ms = 200): boolean {
  const [mounted, setMounted] = React.useState(open);
  React.useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(timer);
  }, [open, ms]);
  return open || mounted;
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
  // Stay rendered for the exit animation; `closing` is true only during that window.
  const rendered = useDelayedUnmount(open, 170);
  const closing = !open && rendered;

  return (
    <Dialog open={rendered} onClose={onClose} className="relative z-50">
      <DialogBackdrop
        className={cn(
          "fixed inset-0 bg-[rgb(var(--ink-950)/0.45)] backdrop-blur-sm",
          closing ? "modal-backdrop-out" : "modal-backdrop-in",
        )}
      />
      <div className="fixed inset-0 overflow-y-auto">
        <div className="flex min-h-full items-start justify-center p-4 sm:items-center sm:p-8">
          <DialogPanel
            className={cn(
              "popover w-full overflow-hidden rounded-[24px]",
              wide ? "max-w-3xl" : "max-w-lg",
              closing ? "modal-panel-out" : "modal-panel-in",
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-6 py-5">
              <div className="min-w-0">
                <DialogTitle className="text-lg font-semibold text-slate-100">{title}</DialogTitle>
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
            <div className="max-h-[75vh] overflow-y-auto px-6 py-5">{children}</div>
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

export function Input({
  trailing,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { trailing?: React.ReactNode }) {
  if (!trailing) {
    return <input {...props} className={cn("input", className)} />;
  }
  return (
    <div className="relative">
      <input {...props} className={cn("input pr-11", className)} />
      <div className="absolute inset-y-0 right-0 flex items-center pr-1.5">{trailing}</div>
    </div>
  );
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
      <p className="figure mt-2 text-[32px] leading-tight">{value}</p>
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
  // View Transition names must be unique and CSS-ident safe.
  const name = `tabs-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const indicator = useSlidingIndicator<HTMLDivElement>('[aria-selected="true"]', active);
  return (
    <div
      ref={indicator.ref}
      role="tablist"
      className="vt-tabs glass relative inline-flex max-w-full flex-wrap gap-1 rounded-full p-1"
      style={{ "--vt-name": name } as React.CSSProperties}
    >
      <span
        aria-hidden="true"
        className={cn("glass-pill pointer-events-none absolute left-0 top-0 rounded-full", !indicator.visible && "opacity-0")}
        style={indicator.style}
      />
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              if (!selected) withViewTransition(() => onChange(tab.id), "tab");
            }}
            className={cn(
              "relative z-10 inline-flex items-center rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50",
              selected
                ? "text-[rgb(var(--on-accent))] delay-75"
                : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span className={cn("num ml-2 text-[11px] opacity-60", selected && "opacity-80")}>
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
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
          "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500/40",
          checked
            ? tone === "warning"
              ? "border-amber-400 bg-amber-400"
              : "border-accent-500 bg-accent-500"
            : "border-white/20 bg-white/[0.06] group-hover:border-white/35",
        )}
      >
        <Check
          className={cn(
            "h-3 w-3 text-[rgb(var(--on-accent))] transition",
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
            : "border-white/15 bg-white/[0.06] group-hover:border-white/25",
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-4 w-4 rounded-full shadow-sm transition-all",
            checked ? "left-6 bg-[rgb(var(--on-accent))]" : "left-1 bg-slate-400",
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

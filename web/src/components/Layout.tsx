import React, { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  ArrowDownUp,
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Server,
  Settings as SettingsIcon,
  Sun,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, formatBytes } from "../api";
import type { Health } from "../types";
import type { Username } from "../App";
import { cn } from "./ui";
import Tooltip from "./Tooltip";
import DeltaMark from "./DeltaMark";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: Database },
  { to: "/servers", label: "Servers", icon: Server },
  { to: "/activity", label: "Activity", icon: Activity },
];

function NavItem({
  item,
  onNavigate,
}: {
  item: { to: string; label: string; icon: React.ElementType };
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-3 rounded-2xl py-2.5 pl-5 pr-3.5 text-[15px] transition",
          isActive
            ? "glass font-semibold text-slate-100 before:absolute before:left-1.5 before:top-1/2 before:h-4 before:w-1 before:-translate-y-1/2 before:rounded-full before:bg-accent-500"
            : "font-medium text-slate-400 hover:bg-white/[0.05] hover:text-slate-100",
        )
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

function useTitle(): string {
  const location = useLocation();
  if (location.pathname.startsWith("/projects/")) return "Project";
  if (location.pathname.startsWith("/projects")) return "Projects";
  if (location.pathname.startsWith("/servers")) return "Servers";
  if (location.pathname.startsWith("/activity")) return "Activity";
  if (location.pathname.startsWith("/transfer")) return "Import / Export";
  if (location.pathname.startsWith("/settings")) return "Settings";
  return "Overview";
}

function HealthDot({ ok, label }: { ok: boolean | undefined; label: string }) {
  return (
    <Tooltip
      side="right"
      content={`${label}: ${ok === undefined ? "checking…" : ok ? "healthy" : "unavailable"}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            ok === undefined ? "bg-slate-600" : ok ? "bg-emerald-500" : "bg-rose-500",
          )}
        />
        <span className="text-[13px] text-slate-300">{label}</span>
        <span className="sr-only">{ok ? "healthy" : "unavailable"}</span>
      </div>
    </Tooltip>
  );
}

function TileLink({
  to,
  label,
  icon: Icon,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: React.ElementType;
  onNavigate: () => void;
}) {
  return (
    <Tooltip content={label}>
      <NavLink
        to={to}
        onClick={onNavigate}
        aria-label={label}
        className={({ isActive }) =>
          cn("icon-tile", isActive && "!border-accent-500/30 !text-slate-100")
        }
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </NavLink>
    </Tooltip>
  );
}

export default function Layout({
  user,
  children,
}: {
  user: Username;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
  );
  const title = useTitle();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api<Health>("/health"),
    refetchInterval: 30_000,
  });

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(next);
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", next === "dark" ? "#0d161b" : "#e6eeec");
    try {
      localStorage.setItem("dp-theme", next);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    window.location.reload();
  };

  const close = () => setOpen(false);
  const themeLabel = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <div className="min-h-screen lg:flex">
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
          aria-hidden="true"
          onClick={close}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-screen w-72 flex-col overflow-y-auto px-4 pb-5 transition-transform lg:sticky lg:top-0 lg:translate-x-0 lg:self-start",
          "max-lg:popover max-lg:rounded-none max-lg:rounded-r-3xl",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-2 pb-6 pt-6">
          <NavLink to="/" className="flex items-center gap-2.5 rounded-xl" onClick={close}>
            <DeltaMark className="h-8 w-8" />
            <span className="text-lg font-semibold tracking-tight text-slate-100">
              Delta<span className="font-normal text-slate-400">Postgres</span>
            </span>
          </NavLink>
          <button
            type="button"
            className="btn-ghost p-2 lg:hidden"
            onClick={close}
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label="Primary">
          {NAV.map((item) => (
            <NavItem key={item.to} item={item} onNavigate={close} />
          ))}
        </nav>

        <div className="mt-6 space-y-4">
          <div className="glass rounded-[20px] p-4">
            <p className="text-[13px] font-medium text-slate-400">System health</p>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
              <HealthDot ok={health.data?.docker?.ok} label="Docker" />
              <HealthDot ok={health.data?.borg?.ok} label="Borg" />
              <HealthDot ok={health.data?.database?.ok} label="Database" />
              <HealthDot ok={health.data?.disk?.ok} label="Disk" />
            </div>
            {health.data?.disk?.free ? (
              <p className="mt-4 text-[13px] text-slate-400">
                <span className="figure text-xl">{formatBytes(health.data.disk.free)}</span>
                <span className="block">free on the backup volume</span>
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2" role="group" aria-label="Quick actions">
            <Tooltip content={themeLabel}>
              <button type="button" onClick={toggleTheme} className="icon-tile" aria-label={themeLabel}>
                {theme === "dark" ? (
                  <Sun className="h-[18px] w-[18px]" strokeWidth={1.75} />
                ) : (
                  <Moon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                )}
              </button>
            </Tooltip>
            <TileLink to="/transfer" label="Import / Export" icon={ArrowDownUp} onNavigate={close} />
            <TileLink to="/settings" label="Settings" icon={SettingsIcon} onNavigate={close} />
          </div>

          <div className="flex items-center gap-2 rounded-full bg-accent-500 py-1.5 pl-4 pr-1.5 text-[rgb(var(--on-accent))]">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user.username}</p>
              <p className="text-[11px] opacity-70">Administrator</p>
            </div>
            <Tooltip content="Sign out" side="top">
              <button
                type="button"
                onClick={logout}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 px-4 py-4 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="icon-tile lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
              aria-expanded={open}
            >
              <Menu className="h-5 w-5" strokeWidth={1.75} />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
              {health.data?.timezone ? (
                <p className="text-[13px] text-slate-500">Schedules run in {health.data.timezone}</p>
              ) : null}
            </div>
          </div>
          {health.data?.worker ? (
            <span className="glass hidden items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] text-slate-400 sm:inline-flex">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  health.data.worker.running > 0 ? "live-dot bg-emerald-500" : "bg-slate-500",
                )}
              />
              <span className="num font-semibold text-slate-100">
                {health.data.worker.running}/{health.data.worker.concurrency}
              </span>
              backup slots in use
            </span>
          ) : null}
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 pb-10 pt-2 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

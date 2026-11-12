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
  ShieldCheck,
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

const NAV_BOTTOM = [
  { to: "/transfer", label: "Import / Export", icon: ArrowDownUp },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
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
          "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
          isActive
            ? "bg-accent-500/10 text-accent-300 before:absolute before:inset-y-1.5 before:-left-3 before:w-[3px] before:rounded-r before:bg-accent-400"
            : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
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
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "h-2 w-2 rounded-[2px]",
            ok === undefined ? "bg-slate-600" : ok ? "bg-emerald-400" : "bg-rose-400",
          )}
        />
        <span className="text-xs text-slate-400">{label}</span>
        <span className="sr-only">{ok ? "healthy" : "unavailable"}</span>
      </div>
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
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("light")
      ? "light"
      : "dark",
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

  return (
    <div className="min-h-screen lg:flex">
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-screen w-64 flex-col overflow-y-auto border-r border-white/[0.07] bg-ink-950 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:self-start",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <NavLink to="/" className="flex items-center gap-2.5 rounded-md" onClick={() => setOpen(false)}>
            <DeltaMark className="h-7 w-7" />
            <span className="text-[17px] font-semibold tracking-tight text-slate-100">
              Delta<span className="text-slate-400">Postgres</span>
            </span>
          </NavLink>
          <button
            type="button"
            className="btn-ghost p-1.5 lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Primary">
          {NAV.map((item) => (
            <NavItem key={item.to} item={item} onNavigate={() => setOpen(false)} />
          ))}
        </nav>

        <div className="space-y-3 border-t border-white/[0.07] px-3 py-4">
          <div className="rounded-lg border border-white/[0.07] bg-ink-900 p-3">
            <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-slate-400">
              <ShieldCheck className="h-3 w-3" />
              System health
            </div>
            <div className="grid grid-cols-2 gap-2">
              <HealthDot ok={health.data?.docker?.ok} label="Docker" />
              <HealthDot ok={health.data?.borg?.ok} label="Borg" />
              <HealthDot ok={health.data?.database?.ok} label="DB" />
              <HealthDot ok={health.data?.disk?.ok} label="Disk" />
            </div>
            {health.data?.disk?.free ? (
              <p className="mt-2.5 text-xs text-slate-500">
                <span className="num text-slate-300">{formatBytes(health.data.disk.free)}</span> free on backup volume
              </p>
            ) : null}
          </div>
          <nav className="space-y-0.5" aria-label="Secondary">
            {NAV_BOTTOM.map((item) => (
              <NavItem key={item.to} item={item} onNavigate={() => setOpen(false)} />
            ))}
          </nav>
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-slate-200">{user.username}</p>
              <p className="text-xs text-slate-500">Administrator</p>
            </div>
            <Tooltip content="Sign out" side="left">
              <button
                onClick={logout}
                className="btn-ghost p-2 hover:text-rose-300"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-950/90 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-ghost p-2 lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
              aria-expanded={open}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-base font-semibold text-slate-100">{title}</h1>
              {health.data?.timezone ? (
                <p className="text-xs text-slate-500">Schedules run in {health.data.timezone}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip content={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
              <button
                onClick={toggleTheme}
                className="btn-secondary p-2"
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>
            </Tooltip>
            <div className="hidden items-center gap-3 sm:flex">
              {health.data?.worker ? (
                <span className="text-xs text-slate-500">
                  <span className="num text-slate-300">
                    {health.data.worker.running}/{health.data.worker.concurrency}
                  </span>{" "}
                  backup slots in use
                </span>
              ) : null}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

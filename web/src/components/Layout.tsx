import React, { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowDownUp,
  Database,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  ShieldCheck,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, formatBytes } from "../api";
import type { Health } from "../types";
import type { Username } from "../App";
import { cn } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: Database },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/transfer", label: "Import / Export", icon: ArrowDownUp },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

function useTitle(): string {
  const location = useLocation();
  if (location.pathname.startsWith("/projects/")) return "Project";
  if (location.pathname.startsWith("/projects")) return "Projects";
  if (location.pathname.startsWith("/activity")) return "Activity";
  if (location.pathname.startsWith("/transfer")) return "Import / Export";
  if (location.pathname.startsWith("/settings")) return "Settings";
  return "Overview";
}

function HealthDot({ ok, label }: { ok: boolean | undefined; label: string }) {
  return (
    <div className="flex items-center gap-1.5" title={`${label}: ${ok ? "healthy" : "unavailable"}`}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          ok ? "bg-emerald-400" : "bg-rose-400",
        )}
      />
      <span className="text-[11px] text-slate-500">{label}</span>
    </div>
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
  const title = useTitle();
  const navigate = useNavigate();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api<Health>("/health"),
    refetchInterval: 30_000,
  });

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    window.location.reload();
  };

  return (
    <div className="min-h-screen lg:flex">
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/5 bg-ink-950/95 backdrop-blur-xl transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent-500/20 bg-accent-500/10">
              <HardDrive className="h-5 w-5 text-accent-400" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-slate-100">DeltaPostgres</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Borg console</p>
            </div>
          </div>
          <button
            className="rounded-lg p-1 text-slate-400 hover:bg-white/5 lg:hidden"
            onClick={() => setOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                    isActive
                      ? "bg-accent-500/10 text-accent-300"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-white/5 px-4 py-4">
          <div className="rounded-xl border border-white/5 bg-ink-900/60 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
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
              <p className="mt-2 text-[10px] text-slate-500">
                {formatBytes(health.data.disk.free)} free on backup volume
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-slate-300">{user.username}</p>
              <p className="text-[10px] text-slate-500">Administrator</p>
            </div>
            <button
              onClick={logout}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-white/5 hover:text-rose-300"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/5 bg-ink-950/80 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 text-slate-400 hover:bg-white/5 lg:hidden"
              onClick={() => setOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-sm font-semibold text-slate-100">{title}</h1>
              <p className="text-[11px] text-slate-500">
                {health.data?.timezone || "Asia/Kolkata"} · Borg-backed PostgreSQL
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            {health.data?.worker ? (
              <span className="text-[11px] text-slate-500">
                {health.data.worker.running} running / {health.data.worker.concurrency} slots
              </span>
            ) : null}
            <button
              onClick={() => navigate("/projects")}
              className="btn-secondary text-xs"
            >
              Manage projects
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

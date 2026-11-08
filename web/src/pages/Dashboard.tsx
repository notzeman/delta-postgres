import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Database,
  HardDrive,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, formatBytes, timeAgo } from "../api";
import type { Health, Project, Stats, DockerServer } from "../types";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBox,
  Spinner,
  StatCard,
  StatusBadge,
  Select,
  cn,
} from "../components/ui";

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-ink-950/95 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-medium text-slate-200">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-slate-400">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
          {p.name}: {formatBytes(p.value)}
        </p>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [serverFilter, setServerFilter] = useState("all");
  const serverQuery = serverFilter === "all" ? "" : `?serverId=${serverFilter}`;
  const statsQuery = useQuery({
    queryKey: ["stats", serverFilter],
    queryFn: () => api<Stats>(`/stats${serverQuery}`),
    refetchInterval: 15_000,
  });
  const projectsQuery = useQuery({
    queryKey: ["projects", serverFilter],
    queryFn: () => api<{ projects: Project[] }>(`/projects${serverQuery}`),
    refetchInterval: 20_000,
  });
  const serversQuery = useQuery({
    queryKey: ["servers"],
    queryFn: () => api<{ servers: DockerServer[] }>("/servers"),
    staleTime: 30_000,
  });
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => api<Health>("/health"),
    refetchInterval: 30_000,
  });

  const backupAll = useMutation({
    mutationFn: () =>
      api<{ jobs: any[] }>("/backups", {
        method: "POST",
        body: JSON.stringify({
          serverId: serverFilter === "all" ? undefined : Number(serverFilter),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const backupOne = useMutation({
    mutationFn: (projectId: number) =>
      api(`/projects/${projectId}/backup`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const stats = statsQuery.data;
  const projects = projectsQuery.data?.projects || [];
  const health = healthQuery.data;
  const chartData = (stats?.storageSeries || []).map((point) => ({
    label: new Date(point.created_at).toLocaleDateString(undefined, {
      month: "short",
      day: "2-digit",
    }),
    original: point.original_size || 0,
    deduplicated: point.deduplicated_size || 0,
  }));

  const failing = projects.filter((project) => project.last_status === "failed");
  const loading = statsQuery.isLoading || projectsQuery.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-400/80">
            Backup posture
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">
            Everything, deduplicated.
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Discover PostgreSQL containers, schedule logical dumps, and store them in encrypted
            Borg repositories with chunk-level delta storage.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={serverFilter}
            onChange={(event) => setServerFilter(event.target.value)}
            className="w-48"
            title="Filter by Docker server"
          >
            <option value="all">All servers</option>
            {(serversQuery.data?.servers || []).map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </Select>
          <Button
            variant="primary"
            onClick={() => backupAll.mutate()}
            loading={backupAll.isPending}
            disabled={projects.length === 0}
          >
            <Zap className="h-4 w-4" />
            Backup all
          </Button>
          <Link to="/projects" className="btn-secondary">
            <Plus className="h-4 w-4" />
            Add project
          </Link>
        </div>
      </div>

      {backupAll.isError ? (
        <ErrorBox message={backupAll.error instanceof Error ? backupAll.error.message : "Backup failed"} />
      ) : null}

      {loading ? (
        <Spinner label="Loading backup overview…" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Projects"
              value={stats?.projects.total ?? 0}
              hint={`${stats?.projects.enabled ?? 0} enabled · ${stats?.projects.failing ?? 0} failing`}
              icon={<Database className="h-4 w-4" />}
              tone="accent"
            />
            <StatCard
              label="Last successful"
              value={stats?.lastSuccessAt ? timeAgo(stats.lastSuccessAt) : "Never"}
              hint={stats?.last24?.success ? `${stats.last24.success} success in last 24h` : "No runs in last 24h"}
              icon={<ShieldCheck className="h-4 w-4" />}
            />
            <StatCard
              label="Repository size"
              value={formatBytes(stats?.repoBytes)}
              hint={`${stats?.archives ?? 0} archives · ${formatBytes(stats?.deduplicatedBytes)} new data`}
              icon={<HardDrive className="h-4 w-4" />}
            />
            <StatCard
              label="Dedup ratio"
              value={
                stats && stats.originalBytes > 0
                  ? `${(stats.originalBytes / Math.max(stats.deduplicatedBytes, 1)).toFixed(1)}×`
                  : "—"
              }
              hint={`${formatBytes(stats?.originalBytes)} logical → ${formatBytes(stats?.deduplicatedBytes)} stored`}
              icon={<Activity className="h-4 w-4" />}
              tone="accent"
            />
          </div>

          {failing.length > 0 ? (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 text-rose-400" />
              <div className="text-sm">
                <p className="font-medium text-rose-200">
                  {failing.length} project{failing.length > 1 ? "s" : ""} need attention
                </p>
                <p className="mt-0.5 text-xs text-rose-300/70">
                  {failing.map((p) => p.name).join(", ")} — open a project to inspect the last error.
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Managed projects"
                subtitle="Scheduled Borg backups across this Docker host"
                action={
                  <Link to="/projects" className="text-xs text-accent-300 hover:text-accent-200">
                    View all
                  </Link>
                }
              />
              {projects.length === 0 ? (
                <EmptyState
                  icon={<Database className="h-8 w-8" />}
                  title="No projects yet"
                  description="Scan Docker for PostgreSQL containers and add your first project."
                  action={
                    <Link to="/projects" className="btn-primary text-xs">
                      <Plus className="h-4 w-4" /> Add project
                    </Link>
                  }
                />
              ) : (
                <div className="divide-y divide-white/5">
                  {projects.slice(0, 8).map((project) => (
                    <div
                      key={project.id}
                      className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <Link to={`/projects/${project.id}`} className="group min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-slate-100 group-hover:text-accent-300">
                            {project.name}
                          </p>
                          <StatusBadge status={project.last_status} />
                          {!project.enabled ? <Badge tone="neutral">disabled</Badge> : null}
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {project.server_name || "local"} · {project.container_name || "no container"} ·{" "}
                          {project.pg_user} · {project.archiveCount ?? 0} archives ·{" "}
                          {formatBytes(project.repoBytes)}
                        </p>
                      </Link>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-slate-500">Last backup</p>
                          <p className="text-xs text-slate-300">{timeAgo(project.last_backup_at)}</p>
                        </div>
                        <div className="hidden sm:block">
                          <p className="text-[10px] uppercase tracking-wider text-slate-500">Next run</p>
                          <p className="text-xs text-slate-300">{timeAgo(project.next_run_at)}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => backupOne.mutate(project.id)}
                          loading={backupOne.isPending && backupOne.variables === project.id}
                          title="Back up now"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Link
                          to={`/projects/${project.id}`}
                          className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-slate-200"
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader
                  title="Storage growth"
                  subtitle="Logical dump vs. new deduplicated data"
                  action={<RefreshCw className="h-3.5 w-3.5 text-slate-600" />}
                />
                <div className="h-56 px-2 py-3">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="orig" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#5eead4" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#5eead4" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="dedup" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#818cf8" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis
                          tick={{ fill: "#64748b", fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          width={48}
                          tickFormatter={(v) => formatBytes(v)}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="original"
                          name="Logical"
                          stroke="#5eead4"
                          fill="url(#orig)"
                          strokeWidth={1.6}
                        />
                        <Area
                          type="monotone"
                          dataKey="deduplicated"
                          name="New stored"
                          stroke="#818cf8"
                          fill="url(#dedup)"
                          strokeWidth={1.6}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState title="No archives yet" description="Run a backup to populate the chart." />
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Recent activity"
                  subtitle="Latest backup jobs"
                  action={
                    <Link to="/activity" className="text-xs text-accent-300 hover:text-accent-200">
                      All jobs
                    </Link>
                  }
                />
                <div className="divide-y divide-white/5">
                  {(stats?.recentJobs || []).slice(0, 6).map((job) => (
                    <div key={job.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-slate-200">
                          {job.project_name || `Project ${job.project_id}`}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {job.trigger} · {timeAgo(job.created_at)}
                        </p>
                      </div>
                      <StatusBadge status={job.status} />
                    </div>
                  ))}
                  {(stats?.recentJobs || []).length === 0 ? (
                    <EmptyState title="No jobs yet" description="Manual or scheduled backups will appear here." />
                  ) : null}
                </div>
              </Card>
            </div>
          </div>

          <Card className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-6">
              <span className="text-[11px] uppercase tracking-wider text-slate-500">Health</span>
              <div className="flex flex-wrap gap-5">
                <span className={cn("text-xs", health?.docker.ok ? "text-emerald-300" : "text-rose-300")}>
                  Docker {health?.docker.ok ? health.docker.version : "unavailable"}
                </span>
                <span className={cn("text-xs", health?.borg.ok ? "text-emerald-300" : "text-rose-300")}>
                  Borg {health?.borg.ok ? health.borg.version : "unavailable"}
                </span>
                <span className={cn("text-xs", health?.database.ok ? "text-emerald-300" : "text-rose-300")}>
                  Metadata DB {health?.database.ok ? "online" : "offline"}
                </span>
                <span className={cn("text-xs", health?.disk.ok ? "text-emerald-300" : "text-rose-300")}>
                  Disk {health?.disk.free ? `${formatBytes(health.disk.free)} free` : "unknown"}
                </span>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

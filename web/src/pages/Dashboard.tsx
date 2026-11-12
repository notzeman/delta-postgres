import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Database,
  HardDrive,
  Play,
  Plus,
  Server,
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
  Skeleton,
  SkeletonRows,
  StatusBadge,
  cn,
} from "../components/ui";
import Picker from "../components/Picker";
import ChunkStrip from "../components/ChunkStrip";
import HoverTip from "../components/Tooltip";

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-[rgb(var(--glass-border))] bg-ink-950 px-4 py-3 text-[13px] shadow-pop">
      <p className="mb-1.5 font-semibold text-slate-100">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-slate-400">
          {p.name}: <span className="num font-semibold text-slate-100">{formatBytes(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

function readVar(name: string, alpha = 1): string {
  if (typeof document === "undefined") return "transparent";
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value ? `rgb(${value} / ${alpha})` : "transparent";
}

/** Chart colors resolved from theme tokens, recomputed when the theme class changes. */
function useChartColors() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return useMemo(
    () => ({
      logical: readVar("--hatch", 0.32),
      stored: readVar("--accent-500"),
      grid: readVar("--white", 0.12),
      tick: readVar("--slate-500"),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
}

type ChartPoint = { label: string; original: number; deduplicated: number };

const chartTooltip = <ChartTooltip />;
const yTick = (v: number) => formatBytes(v);

/**
 * Memoized so dashboard refetches and hover state elsewhere don't re-render
 * (and re-animate) the SVG. It sits in its own paint layer so tooltip moves
 * don't force the frosted card behind it to re-blur.
 */
const StorageChart = React.memo(function StorageChart({ data }: { data: ChartPoint[] }) {
  const colors = useChartColors();
  const tick = useMemo(() => ({ fill: colors.tick, fontSize: 12 }), [colors.tick]);
  const showDots = data.length <= 40;
  return (
    <div className="h-full w-full [contain:layout_paint] [transform:translateZ(0)]">
      <ResponsiveContainer width="100%" height="100%" debounce={120}>
        <AreaChart data={data} margin={{ top: 12, right: 20, left: 4, bottom: 4 }}>
          <defs>
            <pattern id="hatch-logical" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke={colors.logical} strokeWidth="1.2" />
            </pattern>
          </defs>
          <CartesianGrid stroke={colors.grid} strokeDasharray="4 6" vertical={false} />
          <XAxis
            dataKey="label"
            tick={tick}
            axisLine={false}
            tickLine={false}
            tickMargin={10}
            minTickGap={24}
            interval="preserveStartEnd"
            padding={{ left: 12, right: 12 }}
          />
          <YAxis tick={tick} axisLine={false} tickLine={false} width={76} tickFormatter={yTick} />
          <Tooltip
            content={chartTooltip}
            cursor={{ stroke: colors.grid }}
            isAnimationActive={false}
            wrapperStyle={{ outline: "none" }}
          />
          <Area
            type="monotone"
            dataKey="original"
            name="Dump size"
            stroke={colors.logical}
            strokeDasharray="2 5"
            strokeLinecap="round"
            fill="url(#hatch-logical)"
            strokeWidth={2.5}
            dot={showDots ? { r: 2.5, fill: colors.stored, stroke: "none" } : false}
            activeDot={{ r: 4, fill: colors.stored, stroke: "none" }}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="deduplicated"
            name="New data stored"
            stroke={colors.stored}
            fill="transparent"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: colors.stored, stroke: "none" }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});

function LedgerStat({
  icon,
  label,
  value,
  hint,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint: string;
  loading: boolean;
}) {
  return (
    <div className="px-5 py-5 sm:px-6">
      <dt className="flex items-center gap-2 text-[13px] font-medium text-slate-400">
        <span className="text-slate-500">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1.5">
        {loading ? (
          <Skeleton className="h-6 w-24" />
        ) : (
          <>
            <span className="figure text-[30px] leading-tight">{value}</span>
            <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
          </>
        )}
      </dd>
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
  const repoSizeQuery = useQuery({
    queryKey: ["repo-size", serverFilter],
    queryFn: () => api<{ repoBytes: number }>(`/stats/repo-size${serverQuery}`),
    refetchInterval: 60_000,
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
      queryClient.invalidateQueries({ queryKey: ["repo-size"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const backupOne = useMutation({
    mutationFn: (projectId: number) =>
      api(`/projects/${projectId}/backup`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["repo-size"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const stats = statsQuery.data;
  const projects = projectsQuery.data?.projects || [];
  const health = healthQuery.data;
  const chartData = useMemo(() => (stats?.storageSeries || []).map((point) => ({
    label: new Date(point.created_at).toLocaleDateString(undefined, {
      month: "short",
      day: "2-digit",
    }),
    original: point.original_size || 0,
    deduplicated: point.deduplicated_size || 0,
  })), [stats?.storageSeries]);

  const failing = projects.filter((project) => project.last_status === "failed");
  const statsLoading = statsQuery.isLoading;
  const projectsLoading = projectsQuery.isLoading;

  const logicalBytes = stats?.originalBytes ?? 0;
  const storedBytes = stats?.deduplicatedBytes ?? 0;
  const ratio = logicalBytes > 0 ? logicalBytes / Math.max(storedBytes, 1) : 0;

  return (
    <div className="space-y-6">
      {backupAll.isError ? (
        <ErrorBox message={backupAll.error instanceof Error ? backupAll.error.message : "Backup failed"} />
      ) : null}

      <section className="card" aria-labelledby="ledger-title">
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 id="ledger-title" className="text-[13px] font-medium text-slate-400">
              Deduplication across every archive
            </h2>
            {statsLoading ? (
              <Skeleton className="mt-3 h-10 w-56" />
            ) : (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="figure text-[64px] leading-none">
                  {ratio > 0 ? `${ratio.toFixed(1)}×` : "No data yet"}
                </span>
                {ratio > 0 ? (
                  <span className="max-w-md text-sm text-slate-400">
                    <span className="num text-slate-200">{formatBytes(logicalBytes)}</span> of dumps, only{" "}
                    <span className="num font-semibold text-slate-100">{formatBytes(storedBytes)}</span> stored as new data
                  </span>
                ) : (
                  <span className="text-sm text-slate-400">Run a backup to see how much Borg saves.</span>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Picker
              value={serverFilter}
              onChange={setServerFilter}
              options={[
                { value: "all", label: "All servers" },
                ...(serversQuery.data?.servers || []).map((server) => ({
                  value: String(server.id),
                  label: server.name,
                  description:
                    server.type === "local"
                      ? "Local Docker socket"
                      : `${server.protocol}://${server.host}:${server.port}`,
                  icon: <Server className="h-4 w-4" />,
                })),
              ]}
              searchable
              ariaLabel="Filter by Docker server"
              className="w-44"
            />
            <Button
              variant="primary"
              onClick={() => backupAll.mutate()}
              loading={backupAll.isPending}
              disabled={projects.length === 0}
            >
              <Zap className="h-4 w-4" />
              Back up all
            </Button>
            <Link to="/projects" className="btn-secondary">
              <Plus className="h-4 w-4" />
              Add project
            </Link>
          </div>
        </div>

        <div className="px-5 sm:px-6">
          <ChunkStrip logical={statsLoading ? 0 : logicalBytes} stored={storedBytes} count={40} />
          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="hatch h-3 w-3 rounded" /> Already in the repository
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-delta-400" /> Stored as new data
            </span>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-1 divide-y divide-white/[0.08] border-t border-white/[0.08] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <LedgerStat
            icon={<Database className="h-4 w-4" />}
            label="Projects"
            loading={statsLoading}
            value={stats?.projects.total ?? 0}
            hint={`${stats?.projects.enabled ?? 0} enabled, ${stats?.projects.failing ?? 0} failing`}
          />
          <LedgerStat
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Last successful backup"
            loading={statsLoading}
            value={stats?.lastSuccessAt ? timeAgo(stats.lastSuccessAt) : "Never"}
            hint={
              stats?.last24?.success
                ? `${stats.last24.success} successful in the last 24 hours`
                : "No backups in the last 24 hours"
            }
          />
          <LedgerStat
            icon={<HardDrive className="h-4 w-4" />}
            label="Repository size"
            loading={repoSizeQuery.isLoading}
            value={formatBytes(repoSizeQuery.data?.repoBytes)}
            hint={`${stats?.archives ?? 0} archives on disk`}
          />
        </dl>
      </section>

      {failing.length > 0 ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.07] px-4 py-3"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-rose-200">
              {failing.length === 1
                ? `${failing[0].name} failed its last backup`
                : `${failing.length} projects failed their last backup`}
            </p>
            <p className="mt-0.5 text-[13px] text-rose-300/80">
              {failing.length === 1
                ? "Open the project to read the error and retry."
                : `${failing.map((p) => p.name).join(", ")}. Open a project to read its error.`}
            </p>
          </div>
          {failing.length === 1 ? (
            <Link to={`/projects/${failing[0].id}`} className="btn-danger shrink-0 px-3 py-1.5 text-xs">
              Open project
            </Link>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Storage growth"
          subtitle="Size of each dump compared with the new data Borg stored"
        />
        <div className="h-72 px-3 pb-4 pt-5 sm:h-80 sm:px-5">
          {statsLoading ? (
            <Skeleton className="h-full w-full" />
          ) : chartData.length > 0 ? (
            <StorageChart data={chartData} />
          ) : (
            <EmptyState title="No archives yet" description="Run a backup to populate the chart." />
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Managed projects"
                subtitle="Most recently configured projects and their next scheduled run"
                action={
                  <Link to="/projects" className="text-xs text-accent-300 hover:text-accent-200">
                    View all
                  </Link>
                }
              />
              {projectsLoading ? (
                <SkeletonRows rows={5} label="Loading projects" />
              ) : projects.length === 0 ? (
                <EmptyState
                  icon={<Database className="h-8 w-8" />}
                  title="No projects yet"
                  description="Scan your Docker hosts for PostgreSQL containers, or add one by hand."
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
                          <p className="text-xs text-slate-500">Last backup</p>
                          <p className="text-[13px] text-slate-200">{timeAgo(project.last_backup_at)}</p>
                        </div>
                        <div className="hidden sm:block">
                          <p className="text-xs text-slate-500">Next run</p>
                          <p className="text-[13px] text-slate-200">{timeAgo(project.next_run_at)}</p>
                        </div>
                        <HoverTip content="Back up this project now">
                          <Button
                            size="sm"
                            onClick={() => backupOne.mutate(project.id)}
                            loading={backupOne.isPending && backupOne.variables === project.id}
                            aria-label="Back up now"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        </HoverTip>
                        <HoverTip content="Open project">
                          <Link
                            to={`/projects/${project.id}`}
                            className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-slate-200"
                            aria-label="Open project"
                          >
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </HoverTip>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <div className="space-y-6">

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
                {statsLoading ? (
                  <SkeletonRows rows={3} label="Loading activity" />
                ) : (
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
                )}
              </Card>
            </div>
      </div>
    </div>
  );
}

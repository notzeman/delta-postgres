import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Database,
  EyeOff,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldQuestion,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { api, formatBytes, fmtDate, timeAgo } from "../api";
import type {
  ContainerOption,
  DiscoveredProject,
  DiscoveryResponse,
  DockerServer,
  Project,
} from "../types";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Spinner,
  StatusBadge,
  Tabs,
  cn,
} from "../components/ui";
import CronField from "../components/CronField";
import Picker from "../components/Picker";
import Tooltip from "../components/Tooltip";
import ConfirmModal from "../components/ConfirmModal";

interface AddPayload {
  name: string;
  serverId: number;
  containerId?: string;
  containerName?: string;
  pgUser?: string;
  databases?: string[] | null;
  scheduleCron?: string | null;
  keepDaily?: number | null;
  keepWeekly?: number | null;
  keepMonthly?: number | null;
  notes?: string | null;
  force?: boolean;
}

function discoveryIgnoreKey(project: DiscoveredProject): string {
  return project.composeProject || project.containers[0]?.name || project.key;
}

function AddProjectModal({
  open,
  onClose,
  servers,
  defaultServerId,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  servers: DockerServer[];
  defaultServerId?: number;
  prefill?: DiscoveredProject | null;
}) {
  const queryClient = useQueryClient();
  const initialContainer =
    prefill?.containers?.find((c) => c.state === "running") || prefill?.containers?.[0];
  const [serverId, setServerId] = useState<number>(
    prefill?.serverId || defaultServerId || servers[0]?.id || 0,
  );
  const [name, setName] = useState(prefill?.name || "");
  const [containerName, setContainerName] = useState(initialContainer?.name || "");
  const [pgUser, setPgUser] = useState(initialContainer?.pgUser || "");
  const [databases, setDatabases] = useState<string[]>(
    prefill?.databases?.length ? prefill.databases : [],
  );
  const [scheduleCron, setScheduleCron] = useState("");
  const [keepDaily, setKeepDaily] = useState("");
  const [keepWeekly, setKeepWeekly] = useState("");
  const [keepMonthly, setKeepMonthly] = useState("");
  const [notes, setNotes] = useState("");
  const [force, setForce] = useState(false);
  const [error, setError] = useState("");

  const containersQuery = useQuery({
    queryKey: ["containers", serverId],
    queryFn: () =>
      api<{ containers: ContainerOption[] }>(`/containers?serverId=${serverId}`),
    enabled: serverId > 0,
  });
  const containers = containersQuery.data?.containers || [];

  const [inspect, setInspect] = useState<{
    isPostgres: boolean;
    pgUser: string;
    databases: Array<{ name: string; sizeBytes: number }>;
    pgVersion: string;
    state: string;
    error?: string;
  } | null>(null);

  const inspectMutation = useMutation({
    mutationFn: (container: string) =>
      api<{
        isPostgres: boolean;
        pgUser: string;
        databases: Array<{ name: string; sizeBytes: number }>;
        pgVersion: string;
        error?: string;
        container: { state: string };
      }>("/projects/inspect", {
        method: "POST",
        body: JSON.stringify({ container, serverId }),
      }),
    onSuccess: (data) => {
      setInspect({
        isPostgres: data.isPostgres,
        pgUser: data.pgUser,
        databases: data.databases,
        pgVersion: data.pgVersion,
        state: data.container.state,
        error: data.error,
      });
      if (data.pgUser) setPgUser(data.pgUser);
      if (databases.length === 0) setDatabases(data.databases.map((db) => db.name));
      if (!name) {
        const option = containers.find((c) => c.name === containerName);
        setName(option?.composeProject || option?.name || "");
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Unable to inspect container"),
  });

  React.useEffect(() => {
    if (!open) return;
    setError("");
    if (prefill) {
      const container =
        prefill.containers.find((c) => c.state === "running") || prefill.containers[0];
      setServerId(prefill.serverId);
      setName(prefill.name);
      setContainerName(container?.name || "");
      setPgUser(container?.pgUser || "");
      setDatabases(prefill.databases);
      if (container?.name) inspectMutation.mutate(container.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  const onServerChange = (value: string) => {
    const id = Number(value);
    setServerId(id);
    setContainerName("");
    setInspect(null);
    setDatabases([]);
    setError("");
    if (!prefill || prefill.serverId !== id) setName("");
  };

  const onContainerChange = (value: string) => {
    setContainerName(value);
    setError("");
    setInspect(null);
    setDatabases([]);
    const option = containers.find((c) => c.name === value);
    if (option) {
      setPgUser(option.pgUser);
      if (!name) setName(option.composeProject || option.name);
    }
    if (value) inspectMutation.mutate(value);
  };

  const create = useMutation({
    mutationFn: (payload: AddPayload) =>
      api<{ project: Project }>("/projects", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["discovery"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Unable to create project"),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const option = containers.find((c) => c.name === containerName);
    create.mutate({
      name,
      serverId,
      containerName,
      containerId: option?.id,
      pgUser: pgUser || undefined,
      databases: databases.length > 0 ? databases : null,
      scheduleCron: scheduleCron || null,
      keepDaily: keepDaily === "" ? null : Number(keepDaily),
      keepWeekly: keepWeekly === "" ? null : Number(keepWeekly),
      keepMonthly: keepMonthly === "" ? null : Number(keepMonthly),
      notes: notes || null,
      force,
    });
  };

  const inputDatabases = inspect?.databases || [];
  const selectedAll = inputDatabases.length > 0 && databases.length === inputDatabases.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={prefill ? `Add ${prefill.name}` : "Add a project"}
      subtitle="A project maps a PostgreSQL container to a dedicated Borg repository."
      wide
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Project name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="my-service"
              required
            />
          </Field>
          <Field label="Docker server" hint={prefill ? "Detected project server" : "Scope this project"}>
            <Picker
              value={String(serverId)}
              onChange={onServerChange}
              options={servers.map((server) => ({
                value: String(server.id),
                label: server.name,
                description:
                  server.type === "local"
                    ? "Local Docker socket"
                    : `${server.protocol}://${server.host}:${server.port}`,
                icon: <Server className="h-4 w-4" />,
              }))}
              placeholder="Select a server…"
              searchable
              disabled={Boolean(prefill)}
              ariaLabel="Docker server"
            />
          </Field>
          <Field label="Docker container" hint="Detected from the selected server">
            <Picker
              value={containerName}
              onChange={onContainerChange}
              options={containers.map((container) => ({
                value: container.name,
                label: container.name,
                description: `${container.state}${container.isPostgres ? "" : " · non-postgres"}`,
                icon: <Database className="h-4 w-4" />,
              }))}
              placeholder="Select a container…"
              searchable
              ariaLabel="Docker container"
            />
          </Field>
        </div>
        {containersQuery.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading containers from server…
          </div>
        ) : null}

        {inspectMutation.isPending ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Inspecting container…
          </div>
        ) : null}

        {inspect && !inspect.isPostgres ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <ShieldQuestion className="mt-0.5 h-4 w-4" />
            <div>
              This container does not look like PostgreSQL. You can still add it, but the backup
              will fail unless it contains pg_dump tools.
              <Checkbox
                checked={force}
                onChange={setForce}
                label="Add anyway"
                description="This container does not look like PostgreSQL."
              />
            </div>
          </div>
        ) : null}

        {inspect?.error ? <ErrorBox message={inspect.error} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="PostgreSQL user">
            <Input
              value={pgUser}
              onChange={(event) => setPgUser(event.target.value)}
              placeholder="postgres"
            />
          </Field>
          <Field label="Server version">
            <Input value={inspect?.pgVersion || "detected automatically"} readOnly />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="label mb-0">Databases</label>
            {inputDatabases.length > 0 ? (
              <button
                type="button"
                className="text-[11px] text-accent-300 hover:text-accent-200"
                onClick={() =>
                  setDatabases(selectedAll ? [] : inputDatabases.map((db) => db.name))
                }
              >
                {selectedAll ? "Clear" : "Select all"}
              </button>
            ) : null}
          </div>
          {inputDatabases.length === 0 ? (
            <p className="rounded-lg border border-white/5 bg-ink-950/50 px-3 py-2 text-xs text-slate-500">
              Select a running PostgreSQL container to list databases. Leave empty to back up all
              databases dynamically.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {inputDatabases.map((db) => (
                <label
                  key={db.name}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition",
                    databases.includes(db.name)
                      ? "border-accent-500/30 bg-accent-500/10 text-accent-100"
                      : "border-white/5 bg-ink-950/40 text-slate-400 hover:border-white/10",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border transition",
                        databases.includes(db.name)
                          ? "border-accent-500 bg-accent-500"
                          : "border-white/15 bg-ink-950/60",
                      )}
                    >
                      <Check
                        className={cn(
                          "h-3 w-3 text-ink-950 transition",
                          databases.includes(db.name) ? "opacity-100" : "opacity-0",
                        )}
                        strokeWidth={3}
                      />
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={databases.includes(db.name)}
                      onChange={(event) =>
                        setDatabases((current) =>
                          event.target.checked
                            ? [...current, db.name]
                            : current.filter((name) => name !== db.name),
                        )
                      }
                    />
                    <span className="font-mono">{db.name}</span>
                  </span>
                  <span className="text-slate-500">{formatBytes(db.sizeBytes)}</span>
                </label>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-slate-500">
            Leave all selected to include future databases automatically.
          </p>
        </div>

        <CronField
          value={scheduleCron}
          onChange={setScheduleCron}
          allowInherit
          hint="Leave inherited to use the global schedule."
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Keep daily" hint="Empty = global">
            <Input
              type="number"
              min={0}
              value={keepDaily}
              onChange={(event) => setKeepDaily(event.target.value)}
              placeholder="7"
            />
          </Field>
          <Field label="Keep weekly" hint="Empty = global">
            <Input
              type="number"
              min={0}
              value={keepWeekly}
              onChange={(event) => setKeepWeekly(event.target.value)}
              placeholder="4"
            />
          </Field>
          <Field label="Keep monthly" hint="Empty = global">
            <Input
              type="number"
              min={0}
              value={keepMonthly}
              onChange={(event) => setKeepMonthly(event.target.value)}
              placeholder="6"
            />
          </Field>
        </div>

        <Field label="Notes">
          <Input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional context for this project"
          />
        </Field>

        {error ? <ErrorBox message={error} /> : null}

        <div className="flex justify-end gap-2 border-t border-white/5 pt-4">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!name || !containerName || !serverId}>
            <Plus className="h-4 w-4" /> Add project
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Projects() {
  const queryClient = useQueryClient();
  const [serverFilter, setServerFilter] = useState("all");
  const [tab, setTab] = useState("managed");
  const [scanRequested, setScanRequested] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [prefill, setPrefill] = useState<DiscoveredProject | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const [actionError, setActionError] = useState("");
  const serverQuery = serverFilter === "all" ? "" : `?serverId=${serverFilter}`;
  const projectsParams = new URLSearchParams();
  if (serverFilter !== "all") projectsParams.set("serverId", serverFilter);
  projectsParams.set("includeIgnored", "1");

  const projectsQuery = useQuery({
    queryKey: ["projects", serverFilter, "all"],
    queryFn: () =>
      api<{ projects: Project[] }>(`/projects?${projectsParams.toString()}`),
    staleTime: 30_000,
    refetchOnMount: false,
  });
  const discoveryQuery = useQuery({
    queryKey: ["discovery", serverFilter],
    queryFn: () => api<DiscoveryResponse>(`/discovery${serverQuery}`),
    // Discovery performs Docker scans and auto-imports. Do not run it just
    // because the Projects page was opened; only when Detected/Ignored is
    // viewed or the user explicitly asks for a Rescan.
    enabled: tab !== "managed" || scanRequested,
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const serversQuery = useQuery({
    queryKey: ["servers"],
    queryFn: () => api<{ servers: DockerServer[] }>("/servers"),
    staleTime: 30_000,
  });

  const backupOne = useMutation({
    mutationFn: (id: number) => api(`/projects/${id}/backup`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: (payload: { serverId: number; composeProject: string; ignore: boolean }) =>
      api("/discovery/ignore", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      setActionError("");
      queryClient.invalidateQueries({ queryKey: ["discovery"] });
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : "Ignore action failed"),
  });

  const removeProject = useMutation({
    mutationFn: (id: number) => api(`/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setActionError("");
      setRemoveTarget(null);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["discovery"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : "Remove failed"),
  });

  const restoreProject = useMutation({
    mutationFn: (id: number) =>
      api(`/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ignored: false }),
      }),
    onSuccess: () => {
      setActionError("");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["discovery"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : "Restore failed"),
  });

  const allProjects = projectsQuery.data?.projects || [];
  const managedProjects = allProjects.filter((project) => !project.ignored);
  const ignoredDbProjects = allProjects.filter((project) => project.ignored);
  const discovered = discoveryQuery.data?.projects || [];
  const servers = serversQuery.data?.servers || [];
  const summary = discoveryQuery.data?.summary || { total: 0, withPostgres: 0 };
  const autoAdd = discoveryQuery.data?.autoAddProjects !== false;
  const ignoredDiscovered = useMemo(
    () => discovered.filter((project) => project.ignored && !project.managedProjectId),
    [discovered],
  );
  const ignoredCount = ignoredDbProjects.length + ignoredDiscovered.length;
  const otherCompose = useMemo(
    () => (discoveryQuery.data?.composeProjects || []).filter((project) => !project.hasPostgres),
    [discoveryQuery.data?.composeProjects],
  );
  const detectable = useMemo(
    () => discovered.filter((project) => !project.ignored && !project.alreadyManaged),
    [discovered],
  );

  const openAdd = (project?: DiscoveredProject) => {
    setPrefill(project || null);
    setAddOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-400/80">
            Projects
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">
            Containers & schedules
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Every Docker Compose project is scanned. PostgreSQL projects are added automatically;
            others are shown below for visibility. Remove a project to ignore it from future scans.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Picker
            value={serverFilter}
            onChange={setServerFilter}
            options={[
              { value: "all", label: "All servers" },
              ...servers.map((server) => ({
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
            ariaLabel="Filter projects by Docker server"
            className="w-52"
          />
          <Button
            onClick={() => {
              setScanRequested(true);
              queryClient.invalidateQueries({ queryKey: ["discovery"] });
              queryClient.invalidateQueries({ queryKey: ["projects"] });
            }}
            loading={discoveryQuery.isFetching || projectsQuery.isFetching}
          >
            <RefreshCw className="h-4 w-4" /> Rescan
          </Button>
          <Button variant="primary" onClick={() => openAdd()}>
            <Plus className="h-4 w-4" /> Add project
          </Button>
        </div>
      </div>

      {actionError ? <ErrorBox message={actionError} /> : null}

      <Tabs
        tabs={[
          { id: "managed", label: "Managed", count: managedProjects.length },
          { id: "detected", label: "Detected", count: detectable.length },
          { id: "ignored", label: "Ignored", count: ignoredCount },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "managed" ? (
        projectsQuery.isLoading ? (
          <Spinner />
        ) : managedProjects.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Database className="h-8 w-8" />}
              title="No managed projects"
              description="Start with an auto-detected PostgreSQL project or add a container manually."
              action={
                <Button variant="primary" onClick={() => openAdd()}>
                  <Plus className="h-4 w-4" /> Add project
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {managedProjects.map((project) => (
              <Card key={project.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={`/projects/${project.id}`}
                      className="truncate text-sm font-semibold text-slate-100 hover:text-accent-300"
                    >
                      {project.name}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {project.container_name || "no container"}
                    </p>
                  </div>
                  <StatusBadge status={project.last_status} />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Repo size</p>
                    <p className="mt-0.5 text-slate-200">{formatBytes(project.repoBytes)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Archives</p>
                    <p className="mt-0.5 text-slate-200">{project.archiveCount ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Last backup</p>
                    <p className="mt-0.5 text-slate-200">{timeAgo(project.last_backup_at)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Next run</p>
                    <p className="mt-0.5 text-slate-200">{timeAgo(project.next_run_at)}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Badge tone={project.containerState === "running" ? "green" : "amber"}>
                    <Server className="h-3 w-3" />
                    {project.containerState || "unknown"}
                  </Badge>
                  <Badge tone="blue">{project.server_name || "local"}</Badge>
                  <Badge tone="neutral">
                    <Sparkles className="h-3 w-3" />
                    {project.schedule_cron || "global schedule"}
                  </Badge>
                  {project.source === "auto" ? <Badge tone="violet">auto</Badge> : null}
                  {!project.enabled ? <Badge tone="neutral">disabled</Badge> : null}
                </div>

                {project.last_status === "failed" && project.last_error ? (
                  <p className="mt-3 line-clamp-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-2.5 py-2 text-[11px] text-rose-300">
                    {project.last_error}
                  </p>
                ) : null}

                <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/5 pt-4">
                  <Button
                    size="sm"
                    onClick={() => backupOne.mutate(project.id)}
                    loading={backupOne.isPending && backupOne.variables === project.id}
                    disabled={!project.enabled}
                  >
                    <Play className="h-3.5 w-3.5" /> Backup now
                  </Button>
                  <Link
                    to={`/projects/${project.id}`}
                    className="flex items-center gap-1 text-xs text-accent-300 hover:text-accent-200"
                  >
                    Open <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <Tooltip content="Move project to Ignored">
                    <button
                      onClick={() => {
                        setActionError("");
                        setRemoveTarget(project);
                      }}
                      className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300"
                      aria-label="Move project to Ignored"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : tab === "detected" ? (
        <div className="space-y-4">
          <div className="flex flex-col justify-between gap-3 rounded-xl border border-white/5 bg-ink-900/60 px-4 py-3 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <Server className="h-3.5 w-3.5 text-accent-400" />
              Scanned
              <span className="font-medium text-slate-200">{summary.total}</span>
              Docker Compose projects ·
              <span className="font-medium text-slate-200">{summary.withPostgres}</span>
              with PostgreSQL
            </div>
            <Badge tone={autoAdd ? "green" : "neutral"}>
              {autoAdd ? "Auto-add on" : "Auto-add off"}
            </Badge>
          </div>

          {discoveryQuery.isLoading ? <Spinner label="Scanning Docker…" /> : null}
          {detectable.length === 0 ? (
            <Card>
              <EmptyState
                icon={<ShieldQuestion className="h-8 w-8" />}
                title="No unmanaged PostgreSQL projects"
                description={
                  autoAdd
                    ? "Detected PostgreSQL projects are added automatically. New Compose projects are picked up every few minutes and whenever you rescan."
                    : "Auto-add is disabled. Use Add project to onboard a detected project manually."
                }
                action={
                  <Button variant="primary" onClick={() => openAdd()}>
                    <Plus className="h-4 w-4" /> Add manually
                  </Button>
                }
              />
            </Card>
          ) : (
            detectable.map((project) => (
              <Card key={project.key} className="p-5">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-100">{project.name}</h3>
                      <Badge tone="blue">{project.serverName}</Badge>
                      <StatusBadge status={project.status} />
                      {project.pgVersion ? <Badge tone="blue">PostgreSQL {project.pgVersion}</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {project.containers.map((c) => c.name).join(", ")} ·{" "}
                      {project.workingDir || "compose project"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {project.databases.map((db) => (
                        <Badge key={db} tone="neutral">
                          {db}
                        </Badge>
                      ))}
                      {project.databases.length === 0 ? (
                        <span className="text-xs text-slate-500">No live databases detected</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500">{formatBytes(project.sizeBytes)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        ignoreMutation.mutate({
                          serverId: project.serverId,
                          composeProject: discoveryIgnoreKey(project),
                          ignore: true,
                        })
                      }
                      title="Ignore this project"
                    >
                      <EyeOff className="h-3.5 w-3.5" /> Ignore
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => openAdd(project)}>
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}

          {otherCompose.length > 0 ? (
            <Card>
              <CardHeader
                title="Other Compose projects"
                subtitle="Scanned on this host · no PostgreSQL service detected"
              />
              <div className="divide-y divide-white/5">
                {otherCompose.map((project) => (
                  <div key={project.name} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="text-xs font-medium text-slate-200">{project.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {project.serverName} · {project.containerCount} container
                        {project.containerCount === 1 ? "" : "s"} · {project.running} running
                      </p>
                    </div>
                    <Badge tone="neutral">no PostgreSQL</Badge>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {ignoredCount === 0 ? (
            <Card>
              <EmptyState
                icon={<Undo2 className="h-8 w-8" />}
                title="No ignored projects"
                description="Projects you move to Ignored stay here with their archives, jobs, and Borg repository intact."
              />
            </Card>
          ) : (
            <>
              {ignoredDbProjects.map((project) => (
                <Card key={`db-${project.id}`} className="p-5">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-100">{project.name}</h3>
                        <Badge tone="blue">{project.server_name || "local"}</Badge>
                        <Badge tone="neutral">ignored</Badge>
                        <StatusBadge status={project.last_status} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {project.container_name || "no container"} ·{" "}
                        {project.archiveCount ?? 0} archives · {formatBytes(project.repoBytes)}
                      </p>
                      {project.compose_project ? (
                        <p className="mt-1 font-mono text-[11px] text-slate-500">
                          {project.compose_project}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Link
                        to={`/projects/${project.id}`}
                        className="btn-secondary text-xs"
                      >
                        Open
                      </Link>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => restoreProject.mutate(project.id)}
                        loading={
                          restoreProject.isPending && restoreProject.variables === project.id
                        }
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Restore
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}

              {ignoredDiscovered.map((project) => (
                <Card key={project.key} className="p-5">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-100">{project.name}</h3>
                        <Badge tone="blue">{project.serverName}</Badge>
                        <Badge tone="neutral">ignored</Badge>
                        <StatusBadge status={project.status} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {project.containers.map((c) => c.name).join(", ")} ·{" "}
                        {project.workingDir || "compose project"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {project.databases.map((db) => (
                          <Badge key={db} tone="neutral">
                            {db}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          ignoreMutation.mutate({
                            serverId: project.serverId,
                            composeProject: discoveryIgnoreKey(project),
                            ignore: false,
                          })
                        }
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Unignore
                      </Button>
                      <Button size="sm" variant="primary" onClick={() => openAdd(project)}>
                        <Plus className="h-3.5 w-3.5" /> Add
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </>
          )}
        </div>
      )}

      <ConfirmModal
        open={Boolean(removeTarget)}
        onClose={() => {
          setRemoveTarget(null);
          setActionError("");
        }}
        onConfirm={() => removeTarget && removeProject.mutate(removeTarget.id)}
        title="Move project to Ignored?"
        description={removeTarget?.name}
        confirmLabel="Move to Ignored"
        loading={removeProject.isPending}
        error={actionError}
      >
        Archives, backup jobs, and the encrypted Borg repository will be kept. The project
        disappears from Managed and auto-discovery will not re-add it.
      </ConfirmModal>

      {addOpen ? (
        <AddProjectModal
          key={prefill?.key || "manual"}
          open={addOpen}
          onClose={() => {
            setAddOpen(false);
            setPrefill(null);
          }}
          servers={servers}
          defaultServerId={serverFilter !== "all" ? Number(serverFilter) : undefined}
          prefill={prefill}
        />
      ) : null}
    </div>
  );
}

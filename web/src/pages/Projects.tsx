import React, { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Database,
  EyeOff,
  Loader2,
  Play,
  Plus,
  Power,
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
  SkeletonRows,
  Spinner,
  StatusBadge,
  Tabs,
  cn,
  useDelayedUnmount,
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

function ProjectCard({
  project,
  onBackup,
  onToggleDisabled,
  onIgnore,
  backupPending,
  togglePending,
}: {
  project: Project;
  onBackup: () => void;
  onToggleDisabled: () => void;
  onIgnore: () => void;
  backupPending: boolean;
  togglePending: boolean;
}) {
  const navigate = useNavigate();
  const openProject = () => navigate(`/projects/${project.id}`);

  return (
    <Card
      className={cn(
        "group flex cursor-pointer flex-col p-5 transition duration-200 hover:-translate-y-0.5 hover:border-accent-500/25",
        "hover:shadow-[0_20px_44px_-28px_rgba(0,0,0,0.7),0_0_26px_-14px_rgba(214,232,228,0.35)]",
        !project.enabled && "border-rose-500/20",
      )}
      onClick={openProject}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openProject();
        }
      }}
      role="link"
      tabIndex={0}
      aria-label={`Open ${project.name}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/projects/${project.id}`}
            onClick={(event) => event.stopPropagation()}
            className="truncate text-sm font-semibold text-slate-100 transition hover:text-accent-300"
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
          <p className="text-xs font-medium text-slate-500">Repo size</p>
          <p className="mt-0.5 text-slate-200">{formatBytes(project.repoBytes)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Archives</p>
          <p className="mt-0.5 text-slate-200">{project.archiveCount ?? 0}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Last backup</p>
          <p className="mt-0.5 text-slate-200">{timeAgo(project.last_backup_at)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">Next run</p>
          <p className="mt-0.5 text-slate-200">
            {project.enabled ? timeAgo(project.next_run_at) : "—"}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone={project.containerState === "running" ? "green" : "amber"}>
          <Server className="h-3 w-3" />
          {project.containerState || "unknown"}
        </Badge>
        <Badge tone="blue">{project.server_name || "local"}</Badge>
        {project.enabled ? (
          <Badge tone="neutral">
            <Sparkles className="h-3 w-3" />
            {project.schedule_cron || "global schedule"}
          </Badge>
        ) : (
          <Badge tone="red">
            <Power className="h-3 w-3" />
            disabled
          </Badge>
        )}
      </div>

      {project.last_status === "failed" && project.last_error ? (
        <p className="mt-3 line-clamp-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-2.5 py-2 text-[11px] text-rose-300">
          {project.last_error}
        </p>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/5 pt-4">
        {/* Icon-only until the card is hovered or focused; the label then slides open.
            Touch screens (no hover) always show it. */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onBackup();
          }}
          disabled={!project.enabled || backupPending}
          aria-label="Back up now"
          className="btn-secondary h-8 gap-0 px-[9px] text-xs"
        >
          {backupPending ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-300 ease-out group-hover:grid-cols-[1fr] group-focus-within:grid-cols-[1fr] [@media(hover:none)]:grid-cols-[1fr]">
            <span className="min-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-hover:delay-75 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              <span className="pl-1.5 pr-0.5">Back up now</span>
            </span>
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          <Tooltip content={project.enabled ? "Disable backups" : "Enable backups"}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleDisabled();
              }}
              className={cn(
                "rounded-full border p-1.5 transition duration-200",
                project.enabled
                  ? "border-rose-500/25 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 hover:shadow-[0_0_16px_-2px_rgba(244,63,94,0.55)]"
                  : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:shadow-[0_0_16px_-2px_rgba(16,185,129,0.55)]",
              )}
              aria-label={project.enabled ? "Disable backups" : "Enable backups"}
            >
              {togglePending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Power className="h-3.5 w-3.5" />
              )}
            </button>
          </Tooltip>
          <Tooltip content="Move project to Ignored">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onIgnore();
              }}
              className="rounded-full border border-white/10 bg-white/5 p-1.5 text-slate-500 transition hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-300 hover:shadow-[0_0_14px_-2px_rgba(244,63,94,0.4)]"
              aria-label="Move project to Ignored"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>
    </Card>
  );
}

export default function Projects() {
  const queryClient = useQueryClient();
  const [serverFilter, setServerFilter] = useState("all");
  const [tab, setTab] = useState("managed");
  const [scanRequested, setScanRequested] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const addMounted = useDelayedUnmount(addOpen);
  const [prefill, setPrefill] = useState<DiscoveredProject | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const [disableTarget, setDisableTarget] = useState<Project | null>(null);
  const [actionError, setActionError] = useState("");
  const serverQuery = serverFilter === "all" ? "" : `?serverId=${serverFilter}`;
  // Set by "Rescan" so the next discovery request bypasses the server cache.
  const forceRefresh = useRef(false);
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
    queryFn: () => {
      const refresh = forceRefresh.current;
      forceRefresh.current = false;
      const suffix = refresh ? `${serverQuery ? "&" : "?"}refresh=1` : "";
      return api<DiscoveryResponse>(`/discovery${serverQuery}${suffix}`);
    },
    // Discovery performs Docker scans and auto-imports. Do not run it just
    // because the Projects page was opened; only when Detected/Ignored is
    // viewed or the user explicitly asks for a Rescan.
    enabled: tab === "detected" || tab === "ignored" || scanRequested,
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

  const toggleProject = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api(`/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      setActionError("");
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : "Unable to update backups"),
  });

  // Turning backups off asks first; turning them back on is safe and immediate.
  const requestToggle = (project: Project) => {
    setActionError("");
    if (project.enabled) setDisableTarget(project);
    else toggleProject.mutate({ id: project.id, enabled: true });
  };

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
  const managedProjects = allProjects.filter((project) => !project.ignored && project.enabled);
  const disabledProjects = allProjects.filter((project) => !project.ignored && !project.enabled);
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
          <h2 className="text-2xl font-semibold tracking-tight text-slate-100">
            Containers & schedules
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
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
              forceRefresh.current = true;
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
          { id: "disabled", label: "Disabled", count: disabledProjects.length },
          { id: "detected", label: "Detected", count: detectable.length },
          { id: "ignored", label: "Ignored", count: ignoredCount },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "managed" ? (
        projectsQuery.isLoading ? (
          <Card>
            <SkeletonRows rows={4} label="Loading projects" />
          </Card>
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
              <ProjectCard
                key={project.id}
                project={project}
                backupPending={backupOne.isPending && backupOne.variables === project.id}
                togglePending={
                  toggleProject.isPending && toggleProject.variables?.id === project.id
                }
                onBackup={() => backupOne.mutate(project.id)}
                onToggleDisabled={() => requestToggle(project)}
                onIgnore={() => {
                  setActionError("");
                  setRemoveTarget(project);
                }}
              />
            ))}
          </div>
        )
      ) : tab === "disabled" ? (
        projectsQuery.isLoading ? (
          <Card>
            <SkeletonRows rows={4} label="Loading projects" />
          </Card>
        ) : disabledProjects.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Power className="h-8 w-8" />}
              title="No disabled projects"
              description="Projects with backups turned off appear here. Use the power button on a project card, or the Disabled option in project settings."
            />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {disabledProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                backupPending={backupOne.isPending && backupOne.variables === project.id}
                togglePending={
                  toggleProject.isPending && toggleProject.variables?.id === project.id
                }
                onBackup={() => backupOne.mutate(project.id)}
                onToggleDisabled={() => requestToggle(project)}
                onIgnore={() => {
                  setActionError("");
                  setRemoveTarget(project);
                }}
              />
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

      <ConfirmModal
        open={Boolean(disableTarget)}
        onClose={() => {
          setDisableTarget(null);
          setActionError("");
        }}
        onConfirm={() =>
          disableTarget &&
          toggleProject.mutate(
            { id: disableTarget.id, enabled: false },
            { onSuccess: () => setDisableTarget(null) },
          )
        }
        title="Disable backups?"
        description={disableTarget?.name}
        confirmLabel="Disable backups"
        loading={toggleProject.isPending}
        error={disableTarget ? actionError : undefined}
      >
        Scheduled backups for this project stop until you turn them back on. Existing archives
        and the Borg repository are kept, and the project moves to the Disabled tab.
      </ConfirmModal>

      {addMounted ? (
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

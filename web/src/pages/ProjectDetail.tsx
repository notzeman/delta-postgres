import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Database,
  Download,
  FileArchive,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Trash2,
  TriangleAlert,
  UploadCloud,
} from "lucide-react";
import { api, downloadUrl, duration, fmtDate, formatBytes, timeAgo } from "../api";
import type { Archive, ArchiveDatabase, Project, ProjectDetailResponse } from "../types";
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
  Spinner,
  StatusBadge,
  SuccessBox,
  Tabs,
  Textarea,
  cn,
} from "../components/ui";
import CronField, { CRON_DISABLED } from "../components/CronField";
import Picker from "../components/Picker";
import Tooltip from "../components/Tooltip";
import ConfirmModal from "../components/ConfirmModal";
import UnsavedChangesGuard from "../components/UnsavedChangesGuard";
import JobLogModal from "../components/JobLogModal";
import { useSnackbar } from "../components/Snackbar";

function DetailStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-ink-950/40 p-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-200">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

const COMPRESSION_MECHANISMS = [
  {
    value: "auto,zstd",
    label: "zstd · auto",
    description: "Compress compressible chunks only · recommended",
  },
  {
    value: "auto,lz4",
    label: "lz4 · auto",
    description: "Compress compressible chunks only · fastest",
  },
  { value: "zstd", label: "zstd", description: "Compress every chunk with zstd" },
  { value: "lz4", label: "lz4", description: "Fastest compressor, larger archives" },
  { value: "zlib", label: "zlib", description: "Older gzip-style compressor" },
  { value: "lzma", label: "lzma", description: "Smallest archives, slowest" },
  { value: "none", label: "none", description: "Store chunks uncompressed" },
];

function compressionSupportsLevel(mechanism: string): boolean {
  return (
    mechanism === "auto,zstd" ||
    mechanism === "zstd" ||
    mechanism === "zlib" ||
    mechanism === "lzma"
  );
}

function parseCompression(spec: string): { mechanism: string; level: string } {
  const parts = (spec || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { mechanism: "auto,zstd", level: "3" };
  if (parts[0] === "auto" && parts.length > 1) {
    const mechanism = `auto,${parts[1]}`;
    return {
      mechanism,
      level: compressionSupportsLevel(mechanism) ? parts[2] || "3" : "",
    };
  }
  const mechanism = parts[0];
  return {
    mechanism,
    level: compressionSupportsLevel(mechanism) ? parts[1] || "3" : "",
  };
}

function buildCompression(mechanism: string, level: string): string {
  if (!compressionSupportsLevel(mechanism)) return mechanism;
  return `${mechanism},${level || "3"}`;
}

export default function ProjectDetail() {
  const { id } = useParams();
  const projectId = Number(id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const snackbar = useSnackbar();
  const [tab, setTab] = useState("overview");
  const [logJob, setLogJob] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<ProjectDetailResponse>(`/projects/${projectId}`),
    refetchInterval: 15_000,
    enabled: Number.isFinite(projectId),
  });

  const project = projectQuery.data?.project;
  const server = projectQuery.data?.server;
  const archives = projectQuery.data?.archives || [];
  const jobs = projectQuery.data?.jobs || [];
  const container = projectQuery.data?.container;

  const [form, setForm] = useState({
    name: "",
    enabled: true,
    pgUser: "",
    databases: "",
    scheduleCron: "",
    keepDaily: "",
    keepWeekly: "",
    keepMonthly: "",
    compression: "",
    notes: "",
  });

  const [savedSettings, setSavedSettings] = useState<typeof form | null>(null);

  const { mechanism: compressionMechanism, level: compressionLevel } = parseCompression(
    form.compression,
  );
  const compressionLevelOptions = compressionSupportsLevel(compressionMechanism)
    ? Array.from({ length: 9 }, (_, index) => String(index + 1))
    : [];
  if (compressionLevel && !compressionLevelOptions.includes(compressionLevel)) {
    compressionLevelOptions.push(compressionLevel);
    compressionLevelOptions.sort((a, b) => Number(a) - Number(b));
  }
  const compressionMechanismOptions = COMPRESSION_MECHANISMS.some(
    (option) => option.value === compressionMechanism,
  )
    ? COMPRESSION_MECHANISMS
    : [
        ...COMPRESSION_MECHANISMS,
        {
          value: compressionMechanism,
          label: compressionMechanism,
          description: "Existing custom value",
        },
      ];

  useEffect(() => {
    if (!project) return;
    const next = {
      name: project.name,
      enabled: project.enabled,
      pgUser: project.pg_user,
      databases: (project.databases || []).join(", "),
      scheduleCron: project.schedule_cron || "",
      keepDaily: project.keep_daily === null ? "" : String(project.keep_daily),
      keepWeekly: project.keep_weekly === null ? "" : String(project.keep_weekly),
      keepMonthly: project.keep_monthly === null ? "" : String(project.keep_monthly),
      compression: project.compression,
      notes: project.notes || "",
    };
    setForm(next);
    setSavedSettings(next);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const settingsDirty =
    savedSettings !== null && JSON.stringify(form) !== JSON.stringify(savedSettings);

  const backupNow = useMutation({
    mutationFn: () => api(`/projects/${projectId}/backup`, { method: "POST" }),
    onSuccess: () => {
      setNotice("Backup queued.");
      setError("");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Unable to queue backup"),
  });

  const syncArchives = useMutation({
    mutationFn: () => api(`/projects/${projectId}/archives/sync`, { method: "POST" }),
    onSuccess: () => {
      setNotice("Archive list synced from Borg.");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Sync failed"),
  });

  const verifyArchive = useMutation({
    mutationFn: (name: string) =>
      api(`/projects/${projectId}/archives/${encodeURIComponent(name)}/verify`, {
        method: "POST",
      }),
    onSuccess: () => {
      setNotice("Archive verified.");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Verify failed"),
  });

  const deleteArchive = useMutation({
    mutationFn: (name: string) =>
      api(`/projects/${projectId}/archives/${encodeURIComponent(name)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      setNotice("Archive deleted.");
      setArchiveToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Delete failed"),
  });

  const saveSettings = useMutation({
    mutationFn: () =>
      api(`/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          enabled: form.enabled,
          pgUser: form.pgUser,
          databases: form.databases.trim()
            ? form.databases.split(",").map((s) => s.trim()).filter(Boolean)
            : null,
          scheduleCron: form.scheduleCron || null,
          keepDaily: form.keepDaily === "" ? null : Number(form.keepDaily),
          keepWeekly: form.keepWeekly === "" ? null : Number(form.keepWeekly),
          keepMonthly: form.keepMonthly === "" ? null : Number(form.keepMonthly),
          compression: form.compression,
          notes: form.notes || null,
        }),
      }),
    onSuccess: () => {
      setSavedSettings(form);
      setNotice("Project settings saved.");
      setError("");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Save failed"),
  });

  const deleteProject = useMutation({
    mutationFn: () => api(`/projects/${projectId}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirmIgnore(false);
      setSavedSettings(form);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["discovery"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      navigate("/projects");
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Remove failed"),
  });

  const restoreProject = useMutation({
    mutationFn: () =>
      api(`/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ ignored: false }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["discovery"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Restore failed"),
  });

  const [restore, setRestore] = useState({
    archive: "",
    overwrite: false,
  });
  // Every restore goes through a warning modal that requires typing CONFIRM.
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [restoreNonce, setRestoreNonce] = useState(() => Date.now());
  const [restoreOutput, setRestoreOutput] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [restoreProgress, setRestoreProgress] = useState({
    running: false,
    percent: 0,
    label: "Ready to restore",
    done: false,
  });
  const [exportDb, setExportDb] = useState("");
  const [transferArchive, setTransferArchive] = useState(
    `imported-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  const [transferFile, setTransferFile] = useState<File | null>(null);
  const [transferDrag, setTransferDrag] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [importedArchive, setImportedArchive] = useState("");
  const [archiveToDelete, setArchiveToDelete] = useState<string | null>(null);
  const [confirmIgnore, setConfirmIgnore] = useState(false);

  const archiveDbsQuery = useQuery({
    queryKey: ["archive-databases", projectId, restore.archive],
    queryFn: () =>
      api<{ databases: ArchiveDatabase[] }>(
        `/projects/${projectId}/archives/${encodeURIComponent(restore.archive)}/databases`,
      ),
    enabled: Boolean(restore.archive),
  });
  const archiveDatabases = archiveDbsQuery.data?.databases;

  const primaryDb =
    project?.pg_default_db ||
    container?.databases?.find((db) => db.name !== "postgres")?.name ||
    "";
  const safePrimary = (primaryDb || "database").replace(/[^a-zA-Z0-9_]/g, "_");
  const exportDatabases = (container?.databases || []).filter((db) => db.name !== "postgres");
  const exportDbValue =
    exportDb && exportDatabases.some((db) => db.name === exportDb)
      ? exportDb
      : exportDatabases.find((db) => db.name === primaryDb)?.name || exportDatabases[0]?.name || "";
  const selectedDump =
    archiveDatabases?.find((db) => db.name === primaryDb) ||
    archiveDatabases?.find((db) => db.name !== "postgres") ||
    archiveDatabases?.[0] ||
    null;
  const scratchTarget = `restore_${safePrimary}_${new Date(restoreNonce)
    .toISOString()
    .replace(/\D/g, "")
    .slice(0, 14)}`;
  const overwriteTarget = selectedDump?.name || primaryDb;
  const targetDb = restore.overwrite ? overwriteTarget : scratchTarget;

  const streamRestore = async (params: {
    archive: string;
    database: string;
    memberPath: string;
    targetDatabase: string;
    overwrite: boolean;
    confirm: string;
  }) => {
    setRestoreOutput("");
    setRestoreError("");
    setRestoreProgress({
      running: true,
      percent: 0,
      label: "Starting restore…",
      done: false,
    });

    let output = "";
    const appendLog = (message: string) => {
      output += `${message}\n`;
      setRestoreOutput(output);
    };

    try {
      const response = await fetch(`/api/projects/${projectId}/restore`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (response.status === 401) {
        window.dispatchEvent(new Event("dp:unauthorized"));
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          (body as any).error || `Restore failed (${response.status})`,
        );
      }
      if (!response.body) throw new Error("Restore stream unavailable");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: any;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === "progress") {
            setRestoreProgress((current) => ({
              ...current,
              percent: Number(event.percent) || current.percent,
              label: String(event.label || current.label),
            }));
          } else if (event.type === "log") {
            appendLog(String(event.message || ""));
          } else if (event.type === "done") {
            sawDone = true;
            const finalOutput = String(event.output || output);
            setRestoreOutput(finalOutput);
            setRestoreProgress({
              running: false,
              percent: 100,
              label: "Restore complete",
              done: true,
            });
            setRestoreNonce(Date.now());
            snackbar.success(
              params.overwrite
                ? `Restore completed into ${params.targetDatabase}.`
                : `Restore completed into new database ${params.targetDatabase}.`,
            );
            queryClient.invalidateQueries({ queryKey: ["project", projectId] });
            queryClient.invalidateQueries({ queryKey: ["projects"] });
          } else if (event.type === "error") {
            throw new Error(String(event.error || "Restore failed"));
          }
        }
      }

      if (!sawDone) {
        throw new Error("Restore stream ended unexpectedly");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Restore failed";
      setRestoreError(message);
      setRestoreProgress({
        running: false,
        percent: 100,
        label: "Restore failed",
        done: false,
      });
      snackbar.error(message);
    }
  };

  const runRestore = async () => {
    if (!selectedDump) {
      snackbar.error("No database dump was found in this archive.");
      return;
    }
    if (!targetDb) {
      snackbar.error("Unable to determine the target database.");
      return;
    }
    await streamRestore({
      archive: restore.archive,
      database: selectedDump.name,
      memberPath: selectedDump.path,
      targetDatabase: targetDb,
      overwrite: restore.overwrite,
      confirm: restoreConfirm,
    });
  };

  const importDump = useMutation({
    mutationFn: async () => {
      if (!transferFile) throw new Error("Choose a PostgreSQL dump file first");
      const form = new FormData();
      if (transferArchive.trim()) form.append("archiveName", transferArchive.trim());
      form.append("file", transferFile);
      return api<{
        ok: boolean;
        archive: {
          name: string;
          database: string;
          memberPath: string;
          format: string;
          sizeBytes: number;
        };
        output: string;
      }>(`/projects/${projectId}/import-dump`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: async (data) => {
      setTransferError("");
      setTransferFile(null);
      setImportedArchive(data.archive.name);
      setTransferArchive(`imported-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["archive-databases", projectId] });
      snackbar.success(`Dump added to backups as "${data.archive.name}".`);
    },
    onError: (err) => {
      setImportedArchive("");
      setTransferError(err instanceof Error ? err.message : "Dump import failed");
    },
  });

  const refreshContainer = useMutation({
    mutationFn: () =>
      api<{
        changed: boolean;
        previous: { id: string | null; name: string | null };
        container: { id: string; name: string; image: string; state: string };
      }>(`/projects/${projectId}/refresh-container`, { method: "POST" }),
    onSuccess: (data) => {
      setError("");
      setNotice(
        data.changed
          ? `Container re-linked to ${data.container.name} (${data.container.id.slice(0, 12)})`
          : `Container is up to date: ${data.container.name}`,
      );
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (err) => {
      setNotice("");
      setError(err instanceof Error ? err.message : "Unable to refresh container");
    },
  });

  useEffect(() => {
    if (archives.length === 0) return;
    setRestore((current) => {
      if (archives.some((archive) => archive.name === current.archive)) return current;
      return {
        ...current,
        archive: archives[0].name,
      };
    });
  }, [archives]);

  if (projectQuery.isLoading) return <Spinner label="Loading project…" />;
  if (!project) {
    return (
      <Card>
        <EmptyState
          title="Project not found"
          description="It may have been deleted."
          action={
            <Link to="/projects" className="btn-secondary">
              Back to projects
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <Link
            to="/projects"
            className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Projects
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-100">{project.name}</h2>
            <StatusBadge status={project.last_status} />
            {project.ignored ? <Badge tone="neutral">ignored</Badge> : null}
            {!project.enabled ? <Badge tone="neutral">disabled</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {project.server_name || "local"} · {project.container_name || "no container"} ·{" "}
            {project.container_image || "unknown image"} · {project.pg_user}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {project.ignored ? (
            <Button
              onClick={() => restoreProject.mutate()}
              variant="primary"
              loading={restoreProject.isPending}
            >
              <RotateCcw className="h-4 w-4" /> Restore project
            </Button>
          ) : (
            <Button
              onClick={() => backupNow.mutate()}
              variant="primary"
              loading={backupNow.isPending}
              disabled={!project.enabled}
            >
              <Play className="h-4 w-4" /> Back up now
            </Button>
          )}
          <Button onClick={() => setTab("transfer")}>
            <Download className="h-4 w-4" /> Export / import dump
          </Button>
          <Button onClick={() => setTab("settings")}>
            <SlidersHorizontal className="h-4 w-4" /> Settings
          </Button>
        </div>
      </div>

      {notice ? <SuccessBox message={notice} /> : null}
      {error ? <ErrorBox message={error} /> : null}

      <Tabs
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "backups", label: "Backups", count: archives.length },
          { id: "transfer", label: "Import / export" },
          { id: "restore", label: "Restore" },
          { id: "settings", label: "Settings" },
          { id: "logs", label: "Jobs & logs", count: jobs.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "overview" ? (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader
              title="Project posture"
              subtitle="Live container and backup state"
              action={
                <Button
                  size="sm"
                  onClick={() => refreshContainer.mutate()}
                  loading={refreshContainer.isPending}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh container
                </Button>
              }
            />
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <DetailStat
                label="Container"
                value={project.container_name || "—"}
                hint={container?.state || project.containerState || "unknown"}
              />
              <DetailStat
                label="Docker server"
                value={server?.name || project.server_name || "local"}
                hint={
                  server?.type === "local"
                    ? server.socket_path || "local socket"
                    : server
                      ? `${server.protocol}://${server.host}:${server.port}`
                      : "—"
                }
              />
              <DetailStat
                label="PostgreSQL"
                value={container?.pgVersion || "unknown"}
                hint={container?.image || project.container_image || ""}
              />
              <DetailStat
                label="Schedule"
                value={
                  !project.enabled ? "Disabled" : project.schedule_cron || "Global default"
                }
                hint={project.enabled ? `Next ${timeAgo(project.next_run_at)}` : "No backups"}
              />
              <DetailStat
                label="Last backup"
                value={timeAgo(project.last_backup_at)}
                hint={fmtDate(project.last_backup_at)}
              />
              <DetailStat
                label="Repository"
                value={formatBytes(project.repoBytes)}
                hint={`${archives.length} archives`}
              />
              <DetailStat
                label="Retention"
                value={
                  project.keep_daily == null && project.keep_weekly == null && project.keep_monthly == null
                    ? "Global default"
                    : `${project.keep_daily ?? "global"} / ${project.keep_weekly ?? "global"} / ${project.keep_monthly ?? "global"}`
                }
                hint="daily / weekly / monthly"
              />
            </div>
            {project.last_error ? (
              <div className="mx-5 mb-5 flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="whitespace-pre-wrap">{project.last_error}</span>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Databases" subtitle="Live from the container" />
            <div className="divide-y divide-white/5">
              {(container?.databases || []).map((db) => (
                <div key={db.name} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-2">
                    <Database className="h-3.5 w-3.5 text-slate-500" />
                    <span className="font-mono text-xs text-slate-200">{db.name}</span>
                  </div>
                  <span className="text-[11px] text-slate-500">{formatBytes(db.sizeBytes)}</span>
                </div>
              ))}
              {(container?.databases || []).length === 0 ? (
                <EmptyState
                  title="No live database list"
                  description="The container may be stopped, or the project uses a fixed database selection."
                />
              ) : null}
            </div>
            {project.databases?.length ? (
              <p className="border-t border-white/5 px-5 py-3 text-[11px] text-slate-500">
                Backup selection: <span className="font-mono text-slate-300">{project.databases.join(", ")}</span>
              </p>
            ) : (
              <p className="border-t border-white/5 px-5 py-3 text-[11px] text-slate-500">
                Backing up all discovered databases dynamically.
              </p>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "backups" ? (
        <Card>
          <CardHeader
            title="Borg archives"
            subtitle="Encrypted, deduplicated snapshots in this repository"
            action={
              <Button size="sm" onClick={() => syncArchives.mutate()} loading={syncArchives.isPending}>
                <RefreshCw className="h-3.5 w-3.5" /> Sync
              </Button>
            }
          />
          {archives.length === 0 ? (
            <EmptyState
              icon={<FileArchive className="h-8 w-8" />}
              title="No archives yet"
              description="Run the first backup to create a Borg repository and archive."
              action={
                <Button variant="primary" onClick={() => backupNow.mutate()} loading={backupNow.isPending}>
                  <Play className="h-4 w-4" /> Back up now
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/[0.07] text-left text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Archive</th>
                    <th className="px-3 py-3 font-medium">Created</th>
                    <th className="px-3 py-3 font-medium">Logical</th>
                    <th className="px-3 py-3 font-medium">New stored</th>
                    <th className="px-3 py-3 font-medium">Files</th>
                    <th className="px-3 py-3 font-medium">Verified</th>
                    <th className="px-5 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {archives.map((archive) => (
                    <tr key={archive.id} className="group hover:bg-white/[0.02]">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <FileArchive className="h-3.5 w-3.5 text-accent-400/70" />
                          <span className="font-mono text-xs text-slate-200">{archive.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-400">{fmtDate(archive.created_at)}</td>
                      <td className="px-3 py-3 text-slate-300">{formatBytes(archive.original_size)}</td>
                      <td className="px-3 py-3 text-slate-300">{formatBytes(archive.deduplicated_size)}</td>
                      <td className="px-3 py-3 text-slate-400">{archive.file_count ?? "—"}</td>
                      <td className="px-3 py-3">
                        {archive.verified_at ? (
                          <span className="flex items-center gap-1 text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" /> verified
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip content="Export archive as tar">
                            <a
                              href={downloadUrl(
                                `/projects/${project.id}/archives/${encodeURIComponent(archive.name)}/export`,
                              )}
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-200"
                              aria-label="Export archive"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </a>
                          </Tooltip>
                          <Tooltip content="Verify archive integrity">
                            <button
                              onClick={() => verifyArchive.mutate(archive.name)}
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-emerald-300"
                              aria-label="Verify archive"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                          <Tooltip content="Restore this archive">
                            <button
                              onClick={() => {
                                setRestore((current) => ({ ...current, archive: archive.name }));
                                setTab("restore");
                              }}
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-sky-300"
                              aria-label="Restore archive"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                          <Tooltip content="Delete archive" side="left">
                            <button
                              onClick={() => {
                                setError("");
                                setArchiveToDelete(archive.name);
                              }}
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
                              aria-label="Delete archive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "transfer" ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader
              title="Export database"
              subtitle="Take a fresh pg_dump now and download it"
              action={<Download className="h-4 w-4 text-slate-500" />}
            />
            <div className="space-y-4 p-5">
              <Field
                label="Database"
                hint="Dumped live from the running container in a read-only session."
              >
                <Picker
                  value={exportDbValue}
                  onChange={setExportDb}
                  options={exportDatabases.map((db) => ({
                    value: db.name,
                    label: db.name,
                    description: formatBytes(db.sizeBytes),
                    icon: <Database className="h-4 w-4" />,
                  }))}
                  placeholder={
                    container?.state === "running" ? "Select a database…" : "Container is not running"
                  }
                  disabled={container?.state !== "running" || exportDatabases.length === 0}
                  ariaLabel="Database to export"
                />
              </Field>
              <div className="flex items-center justify-end gap-3">
                <a
                  href={
                    exportDbValue
                      ? downloadUrl(
                          `/projects/${project.id}/dump?database=${encodeURIComponent(exportDbValue)}`,
                        )
                      : "#"
                  }
                  className={cn(
                    "btn-primary shrink-0 text-xs",
                    (!exportDbValue || container?.state !== "running") &&
                      "pointer-events-none opacity-50",
                  )}
                >
                  <Download className="h-3.5 w-3.5" /> Download dump
                </a>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Import a dump"
              subtitle="Add a PostgreSQL dump to this project's backups"
              action={<UploadCloud className="h-4 w-4 text-slate-500" />}
            />
            <form
              className="space-y-4 p-5"
              onSubmit={(event) => {
                event.preventDefault();
                setImportedArchive("");
                setTransferError("");
                importDump.mutate();
              }}
            >
              <label
                onDragOver={(event) => {
                  event.preventDefault();
                  setTransferDrag(true);
                }}
                onDragLeave={() => setTransferDrag(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setTransferDrag(false);
                  const dropped = event.dataTransfer.files?.[0];
                  if (dropped) setTransferFile(dropped);
                }}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition",
                  transferDrag
                    ? "border-accent-500/60 bg-accent-500/5"
                    : "border-white/10 bg-ink-950/40 hover:border-white/20 hover:bg-white/[0.02]",
                )}
              >
                <div className="rounded-full border border-white/10 bg-white/5 p-2.5 text-accent-400">
                  <UploadCloud className="h-5 w-5" />
                </div>
                <p className="text-xs font-medium text-slate-200">
                  {transferFile ? transferFile.name : "Drop a .dump, .backup, .sql, or .tar file here"}
                </p>
                <p className="text-[11px] text-slate-500">
                  {transferFile ? formatBytes(transferFile.size) : "Single-database pg_dump · up to 50 GB"}
                </p>
                <input
                  type="file"
                  className="sr-only"
                  accept=".sql,.dump,.backup,.tar,application/sql,application/octet-stream"
                  onChange={(event) => setTransferFile(event.target.files?.[0] || null)}
                />
              </label>

              <Field label="Backup name" hint="Shown in the Backups list.">
                <Input
                  value={transferArchive}
                  onChange={(event) => setTransferArchive(event.target.value)}
                  className="font-mono"
                />
              </Field>

              {transferError ? <ErrorBox message={transferError} /> : null}
              {importedArchive ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
                  <span className="truncate">
                    Added to backups as <span className="font-mono">{importedArchive}</span>.
                  </span>
                  <Button
                    size="sm"
                    type="button"
                    onClick={() => {
                      setRestore({ archive: importedArchive, overwrite: false });
                      setTab("restore");
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Restore it
                  </Button>
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-slate-500">
                  The dump is only stored as a backup. Nothing is restored until you do it from the
                  Restore tab.
                </p>
                <Button
                  type="submit"
                  variant="primary"
                  loading={importDump.isPending}
                  disabled={!transferFile}
                >
                  <UploadCloud className="h-4 w-4" /> Import dump
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {tab === "restore" ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader
              title="Restore a database"
              subtitle="Extract a dump from Borg and restore it into the container"
            />
            <form
              className="space-y-4 p-5"
              onSubmit={(event) => {
                event.preventDefault();
                setRestoreConfirm("");
                setRestoreModalOpen(true);
              }}
            >
              <Field label="Archive">
                <div className="flex gap-2">
                  <Picker
                    value={restore.archive}
                    onChange={(next) => {
                      setRestore({ archive: next, overwrite: false });
                      setRestoreOutput("");
                      setRestoreError("");
                      setRestoreProgress({
                        running: false,
                        percent: 0,
                        label: "Ready to restore",
                        done: false,
                      });
                    }}
                    options={archives.map((archive) => ({
                      value: archive.name,
                      label: archive.name,
                      description: fmtDate(archive.created_at),
                      icon: <FileArchive className="h-4 w-4" />,
                    }))}
                    placeholder="Select an archive…"
                    searchable
                    disabled={restoreProgress.running}
                    ariaLabel="Archive"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    onClick={() => syncArchives.mutate()}
                    loading={syncArchives.isPending}
                    disabled={restoreProgress.running}
                    title="Refresh archive list"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </Field>
              {archiveDbsQuery.isLoading ? (
                <Field label="Dump file" hint="Reading the selected archive…">
                  <div className="input text-slate-500">Loading archive contents…</div>
                </Field>
              ) : selectedDump ? (
                <Field
                  label="Dump file"
                  hint={
                    selectedDump.name !== primaryDb
                      ? `Primary database ${primaryDb || "unknown"} was not found in this archive; using ${selectedDump.name}.`
                      : "Automatically selected from this archive."
                  }
                >
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <Database className="h-4 w-4 shrink-0 text-accent-400" />
                      <span className="truncate font-mono text-slate-200">
                        {selectedDump.path}
                      </span>
                    </span>
                    <span className="shrink-0 text-slate-500">
                      {formatBytes(selectedDump.sizeBytes)}
                    </span>
                  </div>
                </Field>
              ) : null}
              {archiveDbsQuery.isError ? (
                <ErrorBox
                  message={
                    archiveDbsQuery.error instanceof Error
                      ? archiveDbsQuery.error.message
                      : "Unable to read archive contents"
                  }
                />
              ) : null}
              {!archiveDbsQuery.isLoading &&
              archiveDatabases &&
              archiveDatabases.length === 0 ? (
                <ErrorBox message="No database dumps found in this archive." />
              ) : null}

              <div className="rounded-xl border border-white/5 bg-ink-950/40 px-3 py-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">Target container</span>
                  <span className="truncate font-mono text-slate-200">
                    {container?.name || project.container_name || "—"}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="text-slate-500">Target database</span>
                  <span className="truncate font-mono text-slate-200">
                    {targetDb || "—"}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  {restore.overwrite
                    ? `The database "${targetDb}" will be dropped and recreated before restoring.`
                    : "A new scratch database will be created automatically. The existing database is untouched."}
                </p>
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <Checkbox
                  tone="warning"
                  checked={restore.overwrite}
                  disabled={restoreProgress.running}
                  onChange={(checked) =>
                    setRestore((current) => ({ ...current, overwrite: checked }))
                  }
                  label="Overwrite the existing database"
                  description={
                    restore.overwrite
                      ? `Drops and recreates "${targetDb}" in the container. This disconnects clients.`
                      : "Leave disabled to restore into a new scratch database. Enable to wipe the existing primary database and restore in place."
                  }
                />
              </div>
              {restoreError ? (
                <div className="space-y-2">
                  <ErrorBox message={restoreError} />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => refreshContainer.mutate()}
                    loading={refreshContainer.isPending}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh container and retry
                  </Button>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-slate-500">
                  The dump and target are selected automatically for the project&apos;s primary
                  database.
                </p>
                <Button
                  type="submit"
                  variant="primary"
                  loading={restoreProgress.running}
                  disabled={
                    restoreProgress.running ||
                    !restore.archive ||
                    !selectedDump ||
                    !targetDb
                  }
                >
                  <UploadCloud className="h-4 w-4" /> Restore
                </Button>
              </div>
            </form>
          </Card>
          <Card>
            <CardHeader
              title="Restore output"
              subtitle="Live Borg extraction and pg_restore progress"
              action={
                restoreProgress.done ? (
                  <Badge tone="green">
                    <CheckCircle2 className="h-3 w-3" /> complete
                  </Badge>
                ) : restoreProgress.running ? (
                  <Badge tone="blue">running</Badge>
                ) : null
              }
            />
            <div className="border-b border-white/5 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-medium",
                    restoreError
                      ? "text-rose-300"
                      : restoreProgress.done
                        ? "text-emerald-300"
                        : "text-slate-300",
                  )}
                >
                  {restoreProgress.done ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : restoreProgress.running ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {restoreProgress.label}
                </span>
                <span className="font-mono text-[11px] text-slate-500">
                  {restoreProgress.percent}%
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    restoreError
                      ? "bg-rose-400"
                      : restoreProgress.done
                        ? "bg-emerald-400"
                        : "bg-accent-500",
                    restoreProgress.running && "animate-pulse",
                  )}
                  style={{ width: `${Math.max(2, restoreProgress.percent)}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                {restoreProgress.running
                  ? "Restore is running. Keep this tab open."
                  : restoreProgress.done
                    ? "Restore completed successfully."
                    : restoreError
                      ? restoreError
                      : "Run a restore to see live progress."}
              </p>
            </div>
            <pre className="max-h-[420px] min-h-[240px] overflow-auto p-5 font-mono text-[11px] leading-relaxed text-slate-300">
              {restoreProgress.running
                ? restoreOutput || "Waiting for restore output…"
                : restoreOutput || "The restore log will appear here."}
            </pre>
          </Card>
        </div>
      ) : null}

      {tab === "settings" ? (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Project settings" subtitle="Schedule, retention, and backup scope" />
            <form
              className="space-y-4 p-5"
              onSubmit={(event) => {
                event.preventDefault();
                saveSettings.mutate();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Project name">
                  <Input
                    value={form.name}
                    onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                    required
                  />
                </Field>
                <Field label="PostgreSQL user">
                  <Input
                    value={form.pgUser}
                    onChange={(event) => setForm((f) => ({ ...f, pgUser: event.target.value }))}
                  />
                </Field>
              </div>
              <Field
                label="Databases"
                hint="Comma-separated. Leave empty to back up every database dynamically."
              >
                <Input
                  value={form.databases}
                  onChange={(event) => setForm((f) => ({ ...f, databases: event.target.value }))}
                  placeholder="db1, db2"
                  className="font-mono"
                />
              </Field>
              <CronField
                value={form.scheduleCron}
                disabled={!form.enabled}
                allowDisable
                onChange={(value) => {
                  if (value === CRON_DISABLED) {
                    setForm((f) => ({ ...f, enabled: false }));
                  } else {
                    setForm((f) => ({ ...f, enabled: true, scheduleCron: value }));
                  }
                }}
                allowInherit
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Keep daily">
                  <Input
                    type="number"
                    min={0}
                    value={form.keepDaily}
                    onChange={(event) => setForm((f) => ({ ...f, keepDaily: event.target.value }))}
                    placeholder="global"
                  />
                </Field>
                <Field label="Keep weekly">
                  <Input
                    type="number"
                    min={0}
                    value={form.keepWeekly}
                    onChange={(event) => setForm((f) => ({ ...f, keepWeekly: event.target.value }))}
                    placeholder="global"
                  />
                </Field>
                <Field label="Keep monthly">
                  <Input
                    type="number"
                    min={0}
                    value={form.keepMonthly}
                    onChange={(event) => setForm((f) => ({ ...f, keepMonthly: event.target.value }))}
                    placeholder="global"
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Compression" hint="Borg compression mechanism">
                  <Picker
                    value={compressionMechanism}
                    onChange={(next) =>
                      setForm((f) => ({
                        ...f,
                        compression: buildCompression(next, compressionLevel),
                      }))
                    }
                    options={compressionMechanismOptions}
                    ariaLabel="Compression mechanism"
                  />
                </Field>
                <Field
                  label="Compression level"
                  hint={
                    compressionSupportsLevel(compressionMechanism)
                      ? "Higher means smaller archives but more CPU"
                      : "Not used by this mechanism"
                  }
                >
                  <Picker
                    value={compressionLevel}
                    onChange={(next) =>
                      setForm((f) => ({
                        ...f,
                        compression: buildCompression(compressionMechanism, next),
                      }))
                    }
                    options={compressionLevelOptions.map((level) => ({
                      value: level,
                      label: `Level ${level}`,
                      description: level === "3" ? "Default" : undefined,
                    }))}
                    disabled={!compressionSupportsLevel(compressionMechanism)}
                    placeholder="—"
                    ariaLabel="Compression level"
                  />
                </Field>
              </div>
              <Field label="Notes">
                <Textarea
                  rows={2}
                  value={form.notes}
                  onChange={(event) => setForm((f) => ({ ...f, notes: event.target.value }))}
                />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" variant="primary" loading={saveSettings.isPending}>
                  <Save className="h-4 w-4" /> Save settings
                </Button>
              </div>
            </form>
          </Card>

          <Card className="h-fit border-rose-500/20">
            <CardHeader
              title="Move to Ignored"
              subtitle="Archives, jobs, and the Borg repository are kept"
            />
            <div className="space-y-3 p-5">
              <p className="text-xs text-slate-500">
                This project moves to the <strong>Ignored</strong> section. Its archives, jobs, and
                encrypted Borg repository stay intact, and it will not be auto-discovered again.
              </p>
              <Button
                variant="danger"
                onClick={() => {
                  setError("");
                  setConfirmIgnore(true);
                }}
                loading={deleteProject.isPending}
              >
                <Trash2 className="h-4 w-4" /> Move to Ignored
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "logs" ? (
        <Card>
          <CardHeader title="Recent jobs" subtitle="Click a job to stream its persisted log" />
          <div className="divide-y divide-white/5">
            {jobs.length === 0 ? (
              <EmptyState title="No jobs yet" description="Backups will appear here." />
            ) : (
              jobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => setLogJob(job.id)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-white/[0.03]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Terminal className="h-4 w-4 shrink-0 text-slate-500" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-slate-200">
                        Job #{job.id} · {job.trigger}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {fmtDate(job.started_at || job.created_at)} ·{" "}
                        {duration(job.started_at, job.finished_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {job.error ? (
                      <span className="hidden max-w-[280px] truncate text-[11px] text-rose-300 sm:block">
                        {job.error}
                      </span>
                    ) : null}
                    <StatusBadge status={job.status} />
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>
      ) : null}

      <UnsavedChangesGuard
        dirty={settingsDirty}
        onSave={async () => {
          await saveSettings.mutateAsync();
          setSavedSettings(form);
        }}
      />

      <ConfirmModal
        open={restoreModalOpen}
        onClose={() => setRestoreModalOpen(false)}
        onConfirm={() => {
          setRestoreModalOpen(false);
          void runRestore();
        }}
        title={restore.overwrite ? "Overwrite database?" : "Restore into a new database?"}
        description={`${server?.name || "server"} · ${container?.name || project.container_name || "container"}`}
        confirmLabel={restore.overwrite ? "Overwrite and restore" : "Restore"}
        confirmDisabled={restoreConfirm !== "CONFIRM"}
      >
        <div className="space-y-3">
          <p>
            {restore.overwrite ? (
              <>
                <strong className="text-rose-300">
                  The database <span className="font-mono">{targetDb}</span> will be dropped and
                  replaced
                </strong>{" "}
                with the contents of this backup. Connected clients are disconnected and all current
                data in it is lost.
              </>
            ) : (
              <>
                A new database <span className="font-mono">{targetDb}</span> will be created on this
                server and the backup restored into it. Existing databases are not changed, but the
                restore uses the server&apos;s disk, CPU and I/O while it runs.
              </>
            )}
          </p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
            <dt className="text-slate-500">Backup</dt>
            <dd className="truncate text-slate-200">{restore.archive}</dd>
            <dt className="text-slate-500">Dump</dt>
            <dd className="truncate text-slate-200">{selectedDump?.path || "—"}</dd>
            <dt className="text-slate-500">Target</dt>
            <dd className="truncate text-slate-200">{targetDb || "—"}</dd>
          </dl>
          <Field label="Type CONFIRM to continue">
            <Input
              value={restoreConfirm}
              onChange={(event) => setRestoreConfirm(event.target.value)}
              placeholder="CONFIRM"
              className="font-mono"
              autoFocus
            />
          </Field>
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(archiveToDelete)}
        onClose={() => {
          if (!deleteArchive.isPending) {
            setArchiveToDelete(null);
            setError("");
          }
        }}
        onConfirm={() => archiveToDelete && deleteArchive.mutate(archiveToDelete)}
        title="Delete archive?"
        description={archiveToDelete}
        confirmLabel="Delete archive"
        loading={deleteArchive.isPending}
        error={error}
      >
        This permanently removes the archive from the project&apos;s Borg repository. It cannot
        be undone.
      </ConfirmModal>

      <ConfirmModal
        open={confirmIgnore}
        onClose={() => {
          if (!deleteProject.isPending) {
            setConfirmIgnore(false);
            setError("");
          }
        }}
        onConfirm={() => deleteProject.mutate()}
        title="Move project to Ignored?"
        description={project.name}
        confirmLabel="Move to Ignored"
        loading={deleteProject.isPending}
        error={error}
      >
        Archives, backup jobs, and the encrypted Borg repository will be kept. The project
        disappears from Managed and auto-discovery will not re-add it.
      </ConfirmModal>

      <JobLogModal jobId={logJob} onClose={() => setLogJob(null)} />
    </div>
  );
}

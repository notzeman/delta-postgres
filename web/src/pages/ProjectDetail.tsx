import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Database,
  Download,
  FileArchive,
  HardDrive,
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
import type { Archive, Project, ProjectDetailResponse } from "../types";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Select,
  Spinner,
  StatusBadge,
  SuccessBox,
  Tabs,
  Textarea,
  cn,
} from "../components/ui";
import CronField from "../components/CronField";
import JobLogModal from "../components/JobLogModal";

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
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-200">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const projectId = Number(id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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

  useEffect(() => {
    if (!project) return;
    setForm({
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
    });
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      navigate("/projects");
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Delete failed"),
  });

  const sourceDbs = useMemo(() => {
    const fromProject = project?.databases || [];
    if (fromProject.length) return fromProject;
    return (container?.databases || []).map((db) => db.name);
  }, [project?.databases, container?.databases]);

  const [restore, setRestore] = useState({
    archive: "",
    database: "",
    target: "",
    overwrite: false,
    confirm: "",
  });
  const [restoreOutput, setRestoreOutput] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const restoreMutation = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; output: string }>(`/projects/${projectId}/restore`, {
        method: "POST",
        body: JSON.stringify({
          archive: restore.archive,
          database: restore.database,
          targetDatabase: restore.target,
          overwrite: restore.overwrite,
        }),
      }),
    onSuccess: (data) => {
      setRestoreOutput(data.output || "Restore completed.");
      setRestoreError("");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (err) => {
      setRestoreOutput("");
      setRestoreError(err instanceof Error ? err.message : "Restore failed");
    },
  });

  useEffect(() => {
    if (!restore.archive && archives[0]) {
      setRestore((current) => ({ ...current, archive: archives[0].name }));
    }
    if (!restore.database && sourceDbs[0]) {
      const db = sourceDbs[0];
      setRestore((current) => ({
        ...current,
        database: db,
        target: current.target || `restore_${db}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
      }));
    }
  }, [archives, sourceDbs]); // eslint-disable-line react-hooks/exhaustive-deps

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
            {!project.enabled ? <Badge tone="neutral">disabled</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {project.container_name || "no container"} · {project.container_image || "unknown image"} ·{" "}
            {project.pg_user}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => backupNow.mutate()}
            variant="primary"
            loading={backupNow.isPending}
            disabled={!project.enabled}
          >
            <Play className="h-4 w-4" /> Backup now
          </Button>
          <a href={downloadUrl(`/projects/${project.id}/export`)} className="btn-secondary">
            <Download className="h-4 w-4" /> Export repo
          </a>
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
            <CardHeader title="Project posture" subtitle="Live container and backup state" />
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <DetailStat
                label="Container"
                value={project.container_name || "—"}
                hint={container?.state || project.containerState || "unknown"}
              />
              <DetailStat
                label="PostgreSQL"
                value={container?.pgVersion || "unknown"}
                hint={container?.image || project.container_image || ""}
              />
              <DetailStat
                label="Schedule"
                value={project.schedule_cron || "global"}
                hint={`Next ${timeAgo(project.next_run_at)}`}
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
                value={`${project.keep_daily ?? "global"}d / ${project.keep_weekly ?? "global"}w / ${project.keep_monthly ?? "global"}m`}
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
                  <Play className="h-4 w-4" /> Backup now
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/5 text-[10px] uppercase tracking-wider text-slate-500">
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
                          <span className="font-mono text-[11px] text-slate-200">{archive.name}</span>
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
                          <a
                            href={downloadUrl(
                              `/projects/${project.id}/archives/${encodeURIComponent(archive.name)}/export`,
                            )}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-200"
                            title="Export archive as tar"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                          <button
                            onClick={() => verifyArchive.mutate(archive.name)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-emerald-300"
                            title="Verify archive"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setRestore((current) => ({ ...current, archive: archive.name }));
                              setTab("restore");
                            }}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-sky-300"
                            title="Restore"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete archive ${archive.name}? This cannot be undone.`,
                                )
                              )
                                deleteArchive.mutate(archive.name);
                            }}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"
                            title="Delete archive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
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
                setRestoreOutput("");
                restoreMutation.mutate();
              }}
            >
              <Field label="Archive">
                <Select
                  value={restore.archive}
                  onChange={(event) =>
                    setRestore((current) => ({ ...current, archive: event.target.value }))
                  }
                  required
                >
                  <option value="">Select an archive…</option>
                  {archives.map((archive) => (
                    <option key={archive.id} value={archive.name}>
                      {archive.name} · {fmtDate(archive.created_at)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Source database">
                <Select
                  value={restore.database}
                  onChange={(event) => {
                    const db = event.target.value;
                    setRestore((current) => ({
                      ...current,
                      database: db,
                      target: `restore_${db}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
                    }));
                  }}
                  required
                >
                  <option value="">Select a database…</option>
                  {sourceDbs.map((db) => (
                    <option key={db} value={db}>
                      {db}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Target database" hint="A new database is created by default.">
                <Input
                  value={restore.target}
                  onChange={(event) =>
                    setRestore((current) => ({ ...current, target: event.target.value }))
                  }
                  pattern="[a-zA-Z0-9_]+"
                  required
                />
              </Field>
              <label className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={restore.overwrite}
                  onChange={(event) =>
                    setRestore((current) => ({ ...current, overwrite: event.target.checked }))
                  }
                />
                <span>
                  Overwrite the target database if it exists. This terminates connections and drops
                  the target before restoring.
                </span>
              </label>
              {restore.overwrite ? (
                <Field label={`Type "${restore.target}" to confirm`}>
                  <Input
                    value={restore.confirm}
                    onChange={(event) =>
                      setRestore((current) => ({ ...current, confirm: event.target.value }))
                    }
                    className="font-mono"
                  />
                </Field>
              ) : null}
              {restoreError ? <ErrorBox message={restoreError} /> : null}
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-slate-500">
                  Restores into the same PostgreSQL container.
                </p>
                <Button
                  type="submit"
                  variant="primary"
                  loading={restoreMutation.isPending}
                  disabled={
                    !restore.archive ||
                    !restore.database ||
                    !restore.target ||
                    (restore.overwrite && restore.confirm !== restore.target)
                  }
                >
                  <UploadCloud className="h-4 w-4" /> Restore
                </Button>
              </div>
            </form>
          </Card>
          <Card>
            <CardHeader title="Restore output" subtitle="Borg extraction and pg_restore log" />
            <pre className="max-h-[420px] min-h-[240px] overflow-auto p-5 font-mono text-[11px] leading-relaxed text-slate-300">
              {restoreMutation.isPending
                ? "Restore in progress…"
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
                onChange={(value) => setForm((f) => ({ ...f, scheduleCron: value }))}
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
              <Field label="Compression" hint="Borg compression spec, e.g. auto,zstd,3">
                <Input
                  value={form.compression}
                  onChange={(event) => setForm((f) => ({ ...f, compression: event.target.value }))}
                  className="font-mono"
                />
              </Field>
              <Field label="Notes">
                <Textarea
                  rows={2}
                  value={form.notes}
                  onChange={(event) => setForm((f) => ({ ...f, notes: event.target.value }))}
                />
              </Field>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => setForm((f) => ({ ...f, enabled: event.target.checked }))}
                />
                Enable scheduled backups for this project
              </label>
              <div className="flex justify-end">
                <Button type="submit" variant="primary" loading={saveSettings.isPending}>
                  <Save className="h-4 w-4" /> Save settings
                </Button>
              </div>
            </form>
          </Card>

          <Card className="h-fit border-rose-500/20">
            <CardHeader
              title="Danger zone"
              subtitle="Removing a project does not delete its Borg repository files"
            />
            <div className="space-y-3 p-5">
              <p className="text-xs text-slate-500">
                The project, its jobs, and archive catalog entries are removed. The encrypted repo
                stays at <span className="font-mono text-slate-400">/backups/{project.slug}</span>.
              </p>
              <Button
                variant="danger"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete project ${project.name}? The Borg repository will remain on disk.`,
                    )
                  )
                    deleteProject.mutate();
                }}
                loading={deleteProject.isPending}
              >
                <Trash2 className="h-4 w-4" /> Delete project
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

      <JobLogModal jobId={logJob} onClose={() => setLogJob(null)} />
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  Container,
  Database,
  HardDrive,
  Save,
  Server,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { api, fmtDate, formatBytes } from "../api";
import type { AuditResponse, Settings as SettingsType, Health } from "../types";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorBox,
  Field,
  Input,
  Spinner,
  SuccessBox,
  Switch,
} from "../components/ui";
import CronField from "../components/CronField";
import Pagination from "../components/Pagination";
import Picker from "../components/Picker";
import UnsavedChangesGuard from "../components/UnsavedChangesGuard";

const FALLBACK_TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Australia/Sydney",
];

const TIMEZONES: string[] = (() => {
  try {
    const values = (Intl as any).supportedValuesOf?.("timeZone");
    return Array.isArray(values) && values.length > 0 ? values : FALLBACK_TIMEZONES;
  } catch {
    return FALLBACK_TIMEZONES;
  }
})();

export default function Settings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ settings: SettingsType }>("/settings"),
  });
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => api<Health>("/health"),
    refetchInterval: 30_000,
  });
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(20);
  const auditQuery = useQuery({
    queryKey: ["audit", auditPage, auditPageSize],
    queryFn: () =>
      api<AuditResponse>(`/audit?page=${auditPage}&pageSize=${auditPageSize}`),
  });

  useEffect(() => {
    const page = auditQuery.data?.pagination?.page;
    if (page && page !== auditPage) setAuditPage(page);
  }, [auditQuery.data?.pagination?.page, auditPage]);

  const [form, setForm] = useState({
    globalCron: "0 2 * * *",
    keepDaily: "7",
    keepWeekly: "4",
    keepMonthly: "6",
    notificationWebhook: "",
    autoAddProjects: true,
    timezone: "Asia/Kolkata",
    concurrency: "1",
  });
  const [savedForm, setSavedForm] = useState<typeof form | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!settingsQuery.data?.settings) return;
    const settings = settingsQuery.data.settings;
    const next = {
      globalCron: settings.globalCron,
      keepDaily: String(settings.keepDaily),
      keepWeekly: String(settings.keepWeekly),
      keepMonthly: String(settings.keepMonthly),
      notificationWebhook: settings.notificationWebhook || "",
      autoAddProjects: settings.autoAddProjects !== false,
      timezone: settings.timezone || "Asia/Kolkata",
      concurrency: String(settings.concurrency || 1),
    };
    setForm(next);
    setSavedForm(next);
  }, [settingsQuery.data?.settings]);

  const isDirty = savedForm !== null && JSON.stringify(form) !== JSON.stringify(savedForm);

  const save = useMutation({
    mutationFn: () =>
      api("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          globalCron: form.globalCron,
          keepDaily: Number(form.keepDaily),
          keepWeekly: Number(form.keepWeekly),
          keepMonthly: Number(form.keepMonthly),
          notificationWebhook: form.notificationWebhook,
          autoAddProjects: form.autoAddProjects,
          timezone: form.timezone,
          concurrency: Number(form.concurrency),
        }),
      }),
    onSuccess: () => {
      setSavedForm(form);
      setNotice("Global settings saved. Project schedules using the global cron were recalculated.");
      setError("");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Save failed"),
  });

  const settings = settingsQuery.data?.settings;
  const health = healthQuery.data;
  const audit = auditQuery.data?.audit || [];
  const pagination = auditQuery.data?.pagination;

  if (settingsQuery.isLoading) return <Spinner label="Loading settings…" />;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent-400/80">
          Configuration
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">Settings</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Global schedule and retention defaults. Any project can override its own schedule and
          retention independently.
        </p>
      </div>

      {notice ? <SuccessBox message={notice} /> : null}
      {error ? <ErrorBox message={error} /> : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Global defaults"
            subtitle="Applied to projects that inherit the global schedule"
            action={<CalendarClock className="h-4 w-4 text-slate-500" />}
          />
          <form
            className="space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <CronField
              value={form.globalCron}
              onChange={(value) => setForm((f) => ({ ...f, globalCron: value }))}
              label="Global backup schedule"
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Keep daily">
                <Input
                  type="number"
                  min={0}
                  value={form.keepDaily}
                  onChange={(event) => setForm((f) => ({ ...f, keepDaily: event.target.value }))}
                />
              </Field>
              <Field label="Keep weekly">
                <Input
                  type="number"
                  min={0}
                  value={form.keepWeekly}
                  onChange={(event) => setForm((f) => ({ ...f, keepWeekly: event.target.value }))}
                />
              </Field>
              <Field label="Keep monthly">
                <Input
                  type="number"
                  min={0}
                  value={form.keepMonthly}
                  onChange={(event) => setForm((f) => ({ ...f, keepMonthly: event.target.value }))}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Timezone"
                hint="Cron schedules use this timezone. Restart the container to apply it to OS-level timestamps."
              >
                <Picker
                  value={form.timezone}
                  onChange={(value) => setForm((f) => ({ ...f, timezone: value }))}
                  options={TIMEZONES.map((timezone) => ({
                    value: timezone,
                    label: timezone,
                  }))}
                  searchable
                  ariaLabel="Timezone"
                />
              </Field>
              <Field
                label="Concurrent backup jobs"
                hint="1–10. Applies on the next worker tick; running jobs are not interrupted."
              >
                <Picker
                  value={form.concurrency}
                  onChange={(value) => setForm((f) => ({ ...f, concurrency: value }))}
                  options={Array.from({ length: 10 }, (_, index) => index + 1).map((value) => ({
                    value: String(value),
                    label: `${value} job${value === 1 ? "" : "s"}`,
                  }))}
                  ariaLabel="Concurrent backup jobs"
                />
              </Field>
            </div>
            <Field
              label="Notification webhook"
              hint="Optional. A JSON POST is sent on job success/failure. Use a service like Slack, Discord, or n8n."
            >
              <Input
                value={form.notificationWebhook}
                onChange={(event) =>
                  setForm((f) => ({ ...f, notificationWebhook: event.target.value }))
                }
                placeholder="https://hooks.example.com/…"
              />
            </Field>
            <Switch
              checked={form.autoAddProjects}
              onChange={(checked) =>
                setForm((f) => ({ ...f, autoAddProjects: checked }))
              }
              label="Auto-add discovered projects"
              description="Automatically add PostgreSQL projects found through the Docker Compose scan. Removed projects are ignored and can be restored from the Projects page."
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-slate-500">
                Borg repositories use <span className="font-mono text-slate-400">repokey-blake2</span>{" "}
                encryption with the passphrase in <span className="font-mono text-slate-400">BORG_PASSPHRASE</span>.
              </p>
              <Button type="submit" variant="primary" loading={save.isPending}>
                <Save className="h-4 w-4" /> Save settings
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="System" subtitle="Runtime environment" />
            <div className="divide-y divide-white/5 text-xs">
              {[
                { label: "App version", value: settings?.appVersion, icon: Container },
                { label: "Borg", value: settings?.borgVersion, icon: HardDrive },
                { label: "Timezone", value: settings?.timezone, icon: CalendarClock },
                { label: "Concurrency", value: `${settings?.concurrency} job(s)`, icon: Terminal },
                { label: "Backup root", value: settings?.backupRoot, icon: Database },
                { label: "Docker socket", value: settings?.dockerSocket, icon: Server },
              ].map((row) => {
                const Icon = row.icon;
                return (
                  <div key={row.label} className="flex items-center gap-3 px-5 py-3">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <span className="text-slate-500">{row.label}</span>
                    <span className="ml-auto truncate font-mono text-[11px] text-slate-300">
                      {row.value || "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Health" subtitle="Live connectivity checks" />
            <div className="space-y-2 p-5 text-xs">
              {[
                { label: "Docker Engine", ok: health?.docker?.ok, detail: health?.docker?.version },
                { label: "Borg", ok: health?.borg?.ok, detail: health?.borg?.version },
                { label: "Metadata Postgres", ok: health?.database?.ok, detail: "online" },
                {
                  label: "Backup disk",
                  ok: health?.disk?.ok,
                  detail: health?.disk?.free ? `${formatBytes(health.disk.free)} free` : undefined,
                },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-2">
                  {row.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5 text-rose-400" />
                  )}
                  <span className="text-slate-400">{row.label}</span>
                  <span className="ml-auto text-[11px] text-slate-500">{row.detail || "—"}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Audit log"
          subtitle="Recent authenticated actions"
          action={
            <Button size="sm" onClick={() => auditQuery.refetch()} loading={auditQuery.isFetching}>
              Refresh
            </Button>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/5 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Time</th>
                <th className="px-3 py-3 font-medium">Actor</th>
                <th className="px-3 py-3 font-medium">Action</th>
                <th className="px-3 py-3 font-medium">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {audit.map((entry) => (
                <tr key={entry.id} className="hover:bg-white/[0.02]">
                  <td className="px-5 py-2.5 text-slate-400">{fmtDate(entry.created_at)}</td>
                  <td className="px-3 py-2.5 text-slate-300">{entry.actor || "system"}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone="neutral">{entry.action}</Badge>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-400">
                    {entry.target || "—"}
                  </td>
                </tr>
              ))}
              {auditQuery.isLoading ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8">
                    <Spinner label="Loading audit log…" />
                  </td>
                </tr>
              ) : audit.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-xs text-slate-500">
                    No audit entries yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {pagination ? (
          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            totalPages={pagination.totalPages}
            onPageChange={setAuditPage}
            onPageSizeChange={(size) => {
              setAuditPageSize(size);
              setAuditPage(1);
            }}
          />
        ) : null}
      </Card>

      <UnsavedChangesGuard
        dirty={isDirty}
        onSave={async () => {
          await save.mutateAsync();
          setSavedForm(form);
        }}
      />
    </div>
  );
}

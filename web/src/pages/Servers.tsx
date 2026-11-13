import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  HardDrive,
  Pencil,
  Plus,
  RefreshCw,
  Server as ServerIcon,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api, fmtDate } from "../api";
import type { DockerServer } from "../types";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  SkeletonRows,
  Spinner,
  SuccessBox,
  Switch,
  Textarea,
  cn,
  useDelayedUnmount,
} from "../components/ui";
import Picker from "../components/Picker";
import ConfirmModal from "../components/ConfirmModal";

interface ServerForm {
  name: string;
  type: "local" | "tcp" | "ssh";
  protocol: "http" | "https";
  host: string;
  port: string;
  socketPath: string;
  sshUsername: string;
  sshPassword: string;
  tlsCa: string;
  tlsCert: string;
  tlsKey: string;
  tlsVerify: boolean;
  enabled: boolean;
  resetHostKey: boolean;
}

const EMPTY_FORM: ServerForm = {
  name: "",
  type: "ssh",
  protocol: "http",
  host: "",
  port: "22",
  socketPath: "/var/run/docker.sock",
  sshUsername: "",
  sshPassword: "",
  tlsCa: "",
  tlsCert: "",
  tlsKey: "",
  tlsVerify: true,
  enabled: true,
  resetHostKey: false,
};

function address(server: DockerServer): string {
  if (server.type === "local" || server.protocol === "socket") {
    return server.socket_path || "/var/run/docker.sock";
  }
  if (server.type === "ssh" || server.protocol === "ssh") {
    return `ssh://${server.ssh_username || "root"}@${server.host}:${server.port}`;
  }
  return `${server.protocol}://${server.host}:${server.port}`;
}

function ServerFormModal({
  open,
  editing,
  onClose,
}: {
  open: boolean;
  editing: DockerServer | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ServerForm>(() =>
    editing
      ? {
          name: editing.name,
          type: editing.type,
          protocol: editing.protocol === "https" ? "https" : "http",
          host: editing.host || "",
          port: editing.port
            ? String(editing.port)
            : editing.type === "ssh"
              ? "22"
              : "2375",
          socketPath: editing.socket_path || "/var/run/docker.sock",
          sshUsername: editing.ssh_username || "",
          sshPassword: "",
          tlsCa: "",
          tlsCert: "",
          tlsKey: "",
          tlsVerify: editing.tls_verify,
          enabled: editing.enabled,
          resetHostKey: false,
        }
      : EMPTY_FORM,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testResult, setTestResult] = useState<any>(null);

  const payload = (opts: { includeId?: boolean } = {}) => {
    const base: any = {
      name: form.name,
      type: form.type,
      enabled: form.enabled,
    };
    if (opts.includeId && editing) base.id = editing.id;
    if (form.type === "ssh") {
      base.host = form.host;
      base.port = form.port ? Number(form.port) : 22;
      base.sshUsername = form.sshUsername;
      // Blank password means "keep existing" when editing.
      if (form.sshPassword) base.sshPassword = form.sshPassword;
      if (editing && form.resetHostKey) base.resetHostKey = true;
    } else if (form.type === "tcp") {
      base.protocol = form.protocol;
      base.host = form.host;
      base.port = form.port ? Number(form.port) : null;
      base.tlsVerify = form.tlsVerify;
      // Blank TLS fields mean "keep existing" when editing.
      if (form.tlsCa) base.tlsCa = form.tlsCa;
      if (form.tlsCert) base.tlsCert = form.tlsCert;
      if (form.tlsKey) base.tlsKey = form.tlsKey;
    } else if (!editing) {
      base.socketPath = form.socketPath;
    }
    return base;
  };

  const test = useMutation({
    mutationFn: () =>
      api("/servers/test", {
        method: "POST",
        body: JSON.stringify(payload({ includeId: true })),
      }),
    onSuccess: (data: any) => {
      setTestResult(data);
      setError("");
    },
    onError: (err) => {
      setTestResult(null);
      setError(err instanceof Error ? err.message : "Connection test failed");
    },
  });

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api(`/servers/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload()) })
        : api("/servers", {
            method: "POST",
            body: JSON.stringify({ ...payload(), skipTest: Boolean(testResult?.online) }),
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["servers"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["discovery"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Save failed"),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : "Add Docker server"}
      subtitle="Connect over SSH with a username and password, or use a TCP/TLS Docker endpoint. Credentials are encrypted at rest."
      wide
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name">
            <Input
              value={form.name}
              onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
              placeholder="Production Docker"
              required
            />
          </Field>
          <Field label="Connection type">
            <Picker
              value={form.type}
              onChange={(next) =>
                setForm((f) => ({
                  ...f,
                  type: next as "local" | "tcp" | "ssh",
                  port:
                    next === "ssh"
                      ? "22"
                      : next === "tcp" && (!f.port || f.port === "22")
                        ? "2375"
                        : f.port,
                }))
              }
              options={[
                {
                  value: "ssh",
                  label: "SSH",
                  description: "Username & password over SSH",
                },
                {
                  value: "tcp",
                  label: "TCP / TLS",
                  description: "Remote Docker Engine API",
                },
                {
                  value: "local",
                  label: "Local socket",
                  description: "Unix socket on the dashboard host",
                },
              ]}
              disabled={Boolean(editing)}
              ariaLabel="Connection type"
            />
          </Field>
        </div>

        {form.type === "ssh" ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Server IP or hostname">
                <Input
                  value={form.host}
                  onChange={(event) => setForm((f) => ({ ...f, host: event.target.value }))}
                  placeholder="123.45.67.890"
                  required
                />
              </Field>
              <Field label="SSH username">
                <Input
                  value={form.sshUsername}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, sshUsername: event.target.value }))
                  }
                  placeholder="username"
                  autoComplete="username"
                  required
                />
              </Field>
            </div>
            <Field
              label="SSH password"
              hint={
                editing?.hasSshPassword
                  ? "Stored — leave blank to keep"
                  : "Encrypted at rest with SECRETS_KEY"
              }
            >
              <Input
                type="password"
                value={form.sshPassword}
                onChange={(event) =>
                  setForm((f) => ({ ...f, sshPassword: event.target.value }))
                }
                placeholder={editing?.hasSshPassword ? "••••••••" : ""}
                autoComplete="new-password"
                required={!editing}
              />
            </Field>
          </div>
        ) : form.type === "tcp" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Protocol">
                <Picker
                  value={form.protocol}
                  onChange={(next) =>
                    setForm((f) => ({
                      ...f,
                      protocol: next as "http" | "https",
                      port: next === "https" ? "2376" : "2375",
                    }))
                  }
                  options={[
                    { value: "http", label: "http", description: "Unencrypted · port 2375" },
                    { value: "https", label: "https", description: "TLS · port 2376" },
                  ]}
                  ariaLabel="Protocol"
                />
              </Field>
              <Field label="Host">
                <Input
                  value={form.host}
                  onChange={(event) => setForm((f) => ({ ...f, host: event.target.value }))}
                  placeholder="10.0.0.12 or docker.example.com"
                  required
                />
              </Field>
              <Field label="Port">
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(event) => setForm((f) => ({ ...f, port: event.target.value }))}
                />
              </Field>
            </div>
            <Switch
              checked={form.tlsVerify}
              onChange={(checked) => setForm((f) => ({ ...f, tlsVerify: checked }))}
              label="Verify TLS certificate"
              description="Recommended. Disable only for self-signed endpoints you trust."
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="CA certificate" hint={editing?.hasCa ? "Stored — leave blank to keep" : "PEM contents"}>
                <Textarea
                  rows={4}
                  value={form.tlsCa}
                  onChange={(event) => setForm((f) => ({ ...f, tlsCa: event.target.value }))}
                  placeholder="-----BEGIN CERTIFICATE-----"
                  className="font-mono text-[10px]"
                />
              </Field>
              <Field label="Client certificate" hint={editing?.hasCert ? "Stored — leave blank to keep" : "PEM contents"}>
                <Textarea
                  rows={4}
                  value={form.tlsCert}
                  onChange={(event) => setForm((f) => ({ ...f, tlsCert: event.target.value }))}
                  placeholder="-----BEGIN CERTIFICATE-----"
                  className="font-mono text-[10px]"
                />
              </Field>
              <Field label="Client key" hint={editing?.hasKey ? "Stored — leave blank to keep" : "PEM contents"}>
                <Textarea
                  rows={4}
                  value={form.tlsKey}
                  onChange={(event) => setForm((f) => ({ ...f, tlsKey: event.target.value }))}
                  placeholder="-----BEGIN PRIVATE KEY-----"
                  className="font-mono text-[10px]"
                />
              </Field>
            </div>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
              Expose Docker only over a trusted network. Plain <span className="font-mono">http</span>{" "}
              (port 2375) is unencrypted and should never be public.
            </div>
          </>
        ) : (
          <Field label="Docker socket path">
            <Input
              value={form.socketPath}
              onChange={(event) => setForm((f) => ({ ...f, socketPath: event.target.value }))}
              className="font-mono"
              readOnly={Boolean(editing)}
            />
          </Field>
        )}

        <Switch
          checked={form.enabled}
          onChange={(checked) => setForm((f) => ({ ...f, enabled: checked }))}
          label="Enable this server"
          description="Include it in discovery, schedules, and backup operations."
        />

        {editing && form.type === "ssh" && editing.ssh_host_key ? (
          <div className="rounded-xl border border-white/5 bg-ink-950/40 p-3">
            <p className="text-xs font-medium text-slate-400">Pinned SSH host key</p>
            <p className="mt-1 break-all font-mono text-[11px] text-slate-300">
              {editing.ssh_host_key}
            </p>
            <Switch
              className="mt-3"
              checked={form.resetHostKey}
              onChange={(checked) => setForm((f) => ({ ...f, resetHostKey: checked }))}
              label="Reset host key"
              description="Only if the server was reinstalled or its SSH keys were rotated. The next connection trusts the key it presents."
            />
          </div>
        ) : null}

        {testResult ? (
          testResult.online ? (
            <SuccessBox
              message={`Connected · Docker ${testResult.version} (API ${testResult.apiVersion})`}
            />
          ) : (
            <ErrorBox message={`Connection failed: ${testResult.error}`} />
          )
        ) : null}
        {error ? <ErrorBox message={error} /> : null}

        <div className="flex flex-wrap justify-between gap-2 border-t border-white/5 pt-4">
          <Button
            type="button"
            onClick={() => {
              setError("");
              setNotice("");
              test.mutate();
            }}
            loading={test.isPending}
          >
            <Wifi className="h-4 w-4" /> Test connection
          </Button>
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!form.name}>
              {editing ? "Save changes" : "Add server"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function Servers() {
  const queryClient = useQueryClient();
  const serversQuery = useQuery({
    queryKey: ["servers"],
    queryFn: () => api<{ servers: DockerServer[] }>("/servers"),
    refetchInterval: 30_000,
  });
  const [modalOpen, setModalOpen] = useState(false);
  const modalMounted = useDelayedUnmount(modalOpen);
  const [editing, setEditing] = useState<DockerServer | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DockerServer | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (server: DockerServer) => {
    setEditing(server);
    setModalOpen(true);
  };

  const scan = useMutation({
    mutationFn: (id: number) => api<{ added: number }>(`/servers/${id}/scan`, { method: "POST" }),
    onSuccess: (data) => {
      setNotice(`Scan complete. ${data.added} new project${data.added === 1 ? "" : "s"} added.`);
      queryClient.invalidateQueries({ queryKey: ["servers"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["discovery"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Scan failed"),
  });

  const test = useMutation({
    mutationFn: (id: number) => api<any>(`/servers/${id}/test`, { method: "POST" }),
    onSuccess: (data, id) => {
      setNotice(
        data.online
          ? `Server #${id} is online · Docker ${data.version}`
          : `Server #${id} is offline: ${data.error}`,
      );
      queryClient.invalidateQueries({ queryKey: ["servers"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Test failed"),
  });

  const remove = useMutation({
    mutationFn: ({ id, force }: { id: number; force: boolean }) =>
      api(`/servers/${id}${force ? "?force=true" : ""}`, { method: "DELETE" }),
    onSuccess: () => {
      setNotice("Server removed.");
      setRemoveTarget(null);
      queryClient.invalidateQueries({ queryKey: ["servers"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["discovery"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Remove failed"),
  });

  const servers = serversQuery.data?.servers || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-100">
            Docker servers
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Scope projects to different Docker hosts. SSH servers only need an IP/host, SSH
            username, and password; TCP/TLS endpoints are also supported.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => serversQuery.refetch()} loading={serversQuery.isFetching}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button variant="primary" onClick={openAdd}>
            <Plus className="h-4 w-4" /> Add server
          </Button>
        </div>
      </div>

      {notice ? <SuccessBox message={notice} /> : null}
      {error ? <ErrorBox message={error} /> : null}

      {serversQuery.isLoading ? (
        <Card>
          <SkeletonRows rows={3} label="Checking Docker servers" />
        </Card>
      ) : servers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ServerIcon className="h-8 w-8" />}
            title="No Docker servers"
            description="Add a local socket or a remote Docker Engine API connection."
            action={
              <Button variant="primary" onClick={openAdd}>
                <Plus className="h-4 w-4" /> Add server
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {servers.map((server) => {
            const online = server.status?.online;
            return (
              <Card key={server.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "rounded-xl border p-2",
                        online
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                          : "border-rose-500/20 bg-rose-500/10 text-rose-300",
                      )}
                    >
                      <ServerIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-100">{server.name}</h3>
                        {!server.enabled ? <Badge tone="red">disabled</Badge> : null}
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                        {address(server)}
                      </p>
                    </div>
                  </div>
                  <Badge tone={online ? "green" : "red"}>
                    {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                    {online ? "online" : "offline"}
                  </Badge>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Docker</p>
                    <p className="mt-0.5 text-slate-200">{server.status?.version || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">API</p>
                    <p className="mt-0.5 text-slate-200">{server.status?.apiVersion || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">Projects</p>
                    <p className="mt-0.5 text-slate-200">{server.projectCount ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      {server.type === "ssh" || server.protocol === "ssh" ? "Auth" : "TLS"}
                    </p>
                    <p className="mt-0.5 text-slate-200">
                      {server.type === "ssh" || server.protocol === "ssh"
                        ? server.hasSshPassword
                          ? "password"
                          : "—"
                        : server.protocol === "https"
                          ? server.hasCa || server.hasCert
                            ? "configured"
                            : "no certs"
                          : "—"}
                    </p>
                  </div>
                </div>

                {server.type === "ssh" && server.ssh_host_key ? (
                  <p
                    className="mt-3 truncate font-mono text-[11px] text-slate-500"
                    title={server.ssh_host_key}
                  >
                    Verification Run : {server.ssh_host_key}
                  </p>
                ) : null}

                {server.status?.error && !online ? (
                  <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-[11px] text-rose-300">
                    {server.status.error}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
                  <Button
                    size="sm"
                    onClick={() => {
                      setError("");
                      scan.mutate(server.id);
                    }}
                    loading={scan.isPending && scan.variables === server.id}
                    disabled={!server.enabled}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Scan now
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setError("");
                      test.mutate(server.id);
                    }}
                    loading={test.isPending && test.variables === server.id}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Test
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(server)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  {server.type !== "local" ? (
                    <Button
                      size="sm"
                      variant="danger"
                      className="ml-auto"
                      onClick={() => {
                        setError("");
                        setRemoveTarget(server);
                      }}
                      loading={remove.isPending && remove.variables?.id === server.id}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </Button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmModal
        open={Boolean(removeTarget)}
        onClose={() => {
          if (!remove.isPending) {
            setRemoveTarget(null);
            setError("");
          }
        }}
        onConfirm={() =>
          removeTarget &&
          remove.mutate({
            id: removeTarget.id,
            force: (removeTarget.projectCount || 0) > 0,
          })
        }
        title="Remove Docker server?"
        description={removeTarget?.name}
        confirmLabel="Remove server"
        loading={remove.isPending}
        error={error}
      >
        {removeTarget && (removeTarget.projectCount || 0) > 0 ? (
          <>
            This server still has <strong>{removeTarget.projectCount}</strong> project record
            {removeTarget.projectCount === 1 ? "" : "s"}. Removing it deletes those project
            records from the dashboard. Borg repository files remain on disk.
          </>
        ) : (
          <>This removes only the server connection. No projects will be affected.</>
        )}
      </ConfirmModal>

      {modalMounted ? (
        <ServerFormModal
          key={editing?.id || "new"}
          open={modalOpen}
          editing={editing}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

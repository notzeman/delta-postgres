import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { PassThrough, Writable } from "stream";
import { dockerClient, type ServerRow } from "./servers";
import { config } from "./config";

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  labels: Record<string, string>;
  env: Record<string, string>;
  composeProject: string | null;
  composeService: string | null;
  workingDir: string | null;
  mounts: Array<{ type: string; destination: string; name?: string }>;
  networks: string[];
  created: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Environment for every psql / pg_dump this app runs for discovery and backups.
 * libpq applies PGOPTIONS to the session, so even a bug in this app cannot
 * write to a source database: any write fails with "read-only transaction".
 * PGAPPNAME makes these sessions easy to identify in pg_stat_activity.
 * (Restore is the only write path and deliberately does not use this.)
 */
export const PG_READ_ONLY_ENV = [
  "PGAPPNAME=delta-postgres",
  "PGOPTIONS=-c default_transaction_read_only=on",
];

/** Discovery queries are tiny; bound them so they can never pile up on prod. */
const PG_DISCOVERY_ENV = [
  "PGAPPNAME=delta-postgres",
  "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000",
];

export class ExecAbortedError extends Error {
  constructor() {
    super("Command aborted");
    this.name = "ExecAbortedError";
  }
}

function parseEnv(envList: string[] | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const item of envList || []) {
    const idx = item.indexOf("=");
    if (idx === -1) continue;
    env[item.slice(0, idx)] = item.slice(idx + 1);
  }
  return env;
}

export function normalizeContainerInfo(info: any): ContainerInfo {
  const labels = info.Config?.Labels || {};
  const mounts = (info.Mounts || []).map((m: any) => ({
    type: m.Type,
    destination: m.Destination,
    name: m.Name,
  }));
  const networks = Object.keys(info.NetworkSettings?.Networks || {});
  return {
    id: info.Id,
    name: String(info.Name || "").replace(/^\//, ""),
    image: info.Config?.Image || "",
    state: info.State?.Status || "unknown",
    status: info.State?.Status || "unknown",
    labels,
    env: parseEnv(info.Config?.Env),
    composeProject: labels["com.docker.compose.project"] || null,
    composeService: labels["com.docker.compose.service"] || null,
    workingDir: labels["com.docker.compose.project.working_dir"] || null,
    mounts,
    networks,
    created: info.Created || "",
  };
}

/**
 * Build ContainerInfo from a `docker ps` list entry. The list already carries
 * everything except environment variables, which are only needed for
 * PostgreSQL containers (POSTGRES_USER / POSTGRES_DB).
 */
function containerInfoFromListItem(item: any): ContainerInfo {
  const labels = item.Labels || {};
  return {
    id: item.Id,
    name: String(item.Names?.[0] || "").replace(/^\//, ""),
    image: item.Image || "",
    state: item.State || "unknown",
    status: item.State || "unknown",
    labels,
    env: {},
    composeProject: labels["com.docker.compose.project"] || null,
    composeService: labels["com.docker.compose.service"] || null,
    workingDir: labels["com.docker.compose.project.working_dir"] || null,
    mounts: (item.Mounts || []).map((m: any) => ({
      type: m.Type,
      destination: m.Destination,
      name: m.Name,
    })),
    networks: Object.keys(item.NetworkSettings?.Networks || {}),
    created: item.Created ? new Date(item.Created * 1000).toISOString() : "",
  };
}

/**
 * Whether a list entry needs a full inspect: PostgreSQL images (to read env),
 * plus entries whose image shows as a bare ID (the tag was re-pointed), since
 * only inspect reveals the configured image name.
 */
function needsInspect(item: any): boolean {
  const image = String(item.Image || "");
  return isPostgresImage(image) || /^(sha256:)?[0-9a-f]{12,64}$/i.test(image);
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function listAllContainers(server?: ServerRow | null): Promise<ContainerInfo[]> {
  const docker = dockerClient(server);
  const list = await docker.listContainers({ all: true });
  const infos = await mapWithLimit(list, 4, async (item: any) => {
    if (!needsInspect(item)) return containerInfoFromListItem(item);
    try {
      return normalizeContainerInfo(await docker.getContainer(item.Id).inspect());
    } catch {
      /* container may have disappeared */
      return null;
    }
  });
  return infos.filter((info): info is ContainerInfo => info !== null);
}

export async function getContainer(
  idOrName: string,
  server?: ServerRow | null,
): Promise<ContainerInfo> {
  const docker = dockerClient(server);
  const container = docker.getContainer(idOrName);
  const info = await container.inspect();
  return normalizeContainerInfo(info);
}

export function isPostgresImage(image: string): boolean {
  return /(^|\/)(postgres|postgis|pgvector|timescale|timescaledb|supabase\/postgres)/i.test(
    image,
  );
}

/**
 * Run a command in a container, capturing text output.
 */
export async function execCapture(
  containerId: string,
  cmd: string[],
  opts: { env?: string[]; user?: string } = {},
  server?: ServerRow | null,
): Promise<ExecResult> {
  const docker = dockerClient(server);
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    Env: opts.env,
    User: opts.user,
  });
  const stream = await exec.start({ Detach: false, Tty: false });
  let stdout = "";
  let stderr = "";
  const out = new Writable({
    write(chunk, _enc, cb) {
      stdout += chunk.toString("utf8");
      cb();
    },
  });
  const err = new Writable({
    write(chunk, _enc, cb) {
      stderr += chunk.toString("utf8");
      cb();
    },
  });
  (docker as any).modem.demuxStream(stream, out, err);
  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  // Give demux a tick to flush.
  await new Promise((r) => setTimeout(r, 25));
  const info = await exec.inspect();
  return { exitCode: info.ExitCode ?? 1, stdout, stderr };
}

/**
 * Docker has no API to stop an exec, and closing the attach stream does NOT
 * stop the command: dockerd keeps it running and discards its output. So
 * streaming commands run under a tiny `sh` wrapper whose $0 carries a unique
 * tag (visible in /proc/<pid>/cmdline). `"$@"; exit $?` is not the last
 * command, so sh forks instead of exec'ing and stays as the tagged parent.
 */
const EXEC_TAG_PREFIX = "delta-exec-";

function taggedCommand(cmd: string[], tag: string): string[] {
  return ["sh", "-c", '"$@"; exit $?', `${EXEC_TAG_PREFIX}${tag}`, ...cmd];
}

/**
 * SIGTERM the tagged wrapper's direct children (e.g. pg_dump, which exits
 * cleanly and closes its DB session) and then the wrapper itself. Only reads
 * /proc and writes nothing inside the container. The parent PID is parsed
 * after the last ") " of /proc/<pid>/stat, so process names containing spaces
 * can never be mistaken for a match.
 */
async function terminateTaggedExec(
  containerId: string,
  tag: string,
  server?: ServerRow | null,
): Promise<void> {
  const script = [
    't="$1"',
    "for d in /proc/[0-9]*; do",
    '  c=$(tr "\\000" " " 2>/dev/null < "$d/cmdline") || continue',
    `  case "$c" in "sh -c "*" ${EXEC_TAG_PREFIX}$t "*) ;; *) continue ;; esac`,
    '  w="${d#/proc/}"',
    "  for k in /proc/[0-9]*; do",
    '    s=$(cat 2>/dev/null < "$k/stat") || continue',
    '    s="${s##*) }"',
    "    set -- $s",
    '    [ "$2" = "$w" ] && kill -TERM "${k#/proc/}" 2>/dev/null',
    "  done",
    '  kill -TERM "$w" 2>/dev/null',
    "done",
    "true",
  ].join("\n");
  await execCapture(containerId, ["sh", "-c", script, "sh", tag], {}, server);
}

/**
 * Run a command in a container and stream stdout to a file (binary safe).
 * If `signal` aborts, or the stream is cut off before the command finishes,
 * the command is terminated inside the container instead of running on.
 */
export async function execToFile(
  containerId: string,
  cmd: string[],
  destFile: string,
  onLine?: (line: string) => void,
  opts: { env?: string[]; user?: string; signal?: AbortSignal } = {},
  server?: ServerRow | null,
): Promise<ExecResult> {
  if (opts.signal?.aborted) throw new ExecAbortedError();
  const docker = dockerClient(server);
  const container = docker.getContainer(containerId);
  const tag = crypto.randomUUID();
  const exec = await container.exec({
    Cmd: taggedCommand(cmd, tag),
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    Env: opts.env,
    User: opts.user,
  });
  const stream = await exec.start({ Detach: false, Tty: false });
  const out = fs.createWriteStream(destFile);
  let stderr = "";
  let errBuf = "";
  const err = new Writable({
    write(chunk, _enc, cb) {
      const text = chunk.toString("utf8");
      stderr += text;
      if (onLine) {
        let buf = errBuf + text;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || "";
        errBuf = buf;
        for (const line of lines) if (line.trim()) onLine(line);
      }
      cb();
    },
  });
  (docker as any).modem.demuxStream(stream, out, err);
  let aborted = false;
  let ended = false;
  let stopWaiting: () => void = () => {};
  const onAbort = () => {
    aborted = true;
    // Don't wait for the transport to confirm the close (over SSH that needs a
    // round trip with the remote); terminate the command right away instead.
    stopWaiting();
    stream.destroy();
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      stopWaiting = resolve;
      stream.on("end", () => {
        ended = true;
        resolve();
      });
      // A dropped connection closes without 'end'; exec.inspect below then
      // reports the command as not finished, so the dump counts as failed.
      stream.on("close", resolve);
      stream.on("error", (error: Error) => (aborted ? resolve() : reject(error)));
    });
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    await new Promise<void>((resolve) => out.end(resolve));
    if (aborted || !ended) {
      // Never leave an unattended pg_dump running on the source host.
      await terminateTaggedExec(containerId, tag, server).catch(() => {});
    }
  }
  if (aborted) throw new ExecAbortedError();
  if (onLine && errBuf.trim()) onLine(errBuf);
  const info = await exec.inspect();
  return { exitCode: info.ExitCode ?? 1, stdout: "", stderr };
}

/**
 * Docker multiplexed-stream demuxer that respects backpressure: when the
 * stdout consumer (e.g. a browser download) is slow, it stops accepting input,
 * which pauses the HTTP/SSH stream and, in turn, the command in the container.
 * (docker-modem's demuxStream writes without waiting, so a slow consumer would
 * make it buffer an entire database dump in memory.)
 */
class DockerStreamDemuxer extends Writable {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(
    private readonly stdout: Writable,
    private readonly onStderr: (chunk: Buffer) => void,
  ) {
    super();
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const out: Buffer[] = [];
    while (this.buffer.length >= 8) {
      const type = this.buffer[0];
      const length = this.buffer.readUInt32BE(4);
      if (this.buffer.length < 8 + length) break;
      const payload = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);
      if (type === 2) this.onStderr(payload);
      else out.push(payload);
    }
    if (out.length === 0) return callback();
    let flowing = true;
    for (const payload of out) flowing = this.stdout.write(payload) && flowing;
    if (flowing) callback();
    else this.stdout.once("drain", () => callback());
  }
}

export interface ExecStreamHandle {
  /** Command stdout. Ends on success; errors if the command fails or stops. */
  stdout: PassThrough;
  /** Settles when the command has finished or been stopped. */
  done: Promise<ExecResult>;
  /** Stop the command inside the container (e.g. the client went away). */
  abort: () => void;
}

/**
 * Run a command and expose its stdout as a stream (binary safe, with
 * backpressure). Used for live dump downloads.
 */
export async function execStream(
  containerId: string,
  cmd: string[],
  opts: { env?: string[]; user?: string } = {},
  server?: ServerRow | null,
): Promise<ExecStreamHandle> {
  const docker = dockerClient(server);
  const container = docker.getContainer(containerId);
  const tag = crypto.randomUUID();
  const exec = await container.exec({
    Cmd: taggedCommand(cmd, tag),
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    Env: opts.env,
    User: opts.user,
  });
  const stream: any = await exec.start({ Detach: false, Tty: false });
  const stdout = new PassThrough();
  let stderr = "";
  const demuxer = new DockerStreamDemuxer(stdout, (chunk) => {
    if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8");
  });
  stream.pipe(demuxer);

  let aborted = false;
  let ended = false;
  let stopWaiting: () => void = () => {};
  const abort = () => {
    if (aborted) return;
    aborted = true;
    stopWaiting();
    stream.destroy();
  };

  const done = (async (): Promise<ExecResult> => {
    await new Promise<void>((resolve) => {
      stopWaiting = resolve;
      demuxer.on("finish", () => {
        ended = true;
        resolve();
      });
      stream.on("close", resolve);
      stream.on("error", () => resolve());
    });
    if (aborted || !ended) {
      // Never leave an unattended pg_dump running on the source host.
      await terminateTaggedExec(containerId, tag, server).catch(() => {});
    }
    if (aborted) {
      stdout.destroy(new ExecAbortedError());
      return { exitCode: -1, stdout: "", stderr };
    }
    const info = await exec.inspect().catch(() => null);
    const exitCode = info?.ExitCode ?? 1;
    if (exitCode === 0 && ended) stdout.end();
    // Fail the stream so a download is visibly incomplete, not silently truncated.
    else stdout.destroy(new Error(stderr.trim() || `Command exited with code ${exitCode}`));
    return { exitCode, stdout: "", stderr };
  })();

  return { stdout, done, abort };
}

export async function copyFileToContainer(
  containerId: string,
  hostFile: string,
  destDir = "/tmp",
  server?: ServerRow | null,
): Promise<string> {
  const docker = dockerClient(server);
  const container = docker.getContainer(containerId);
  const base = path.basename(hostFile);
  const tar = spawn("tar", ["-C", path.dirname(hostFile), "-cf", "-", base], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  tar.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const done = new Promise<void>((resolve, reject) => {
    tar.on("error", reject);
    tar.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `tar failed (${code})`));
    });
  });
  await container.putArchive(tar.stdout, { path: destDir });
  await done;
  return path.posix.join(destDir, base);
}

export async function containerDatabases(
  containerId: string,
  pgUser: string,
  server?: ServerRow | null,
): Promise<Array<{ name: string; sizeBytes: number }>> {
  const result = await execCapture(
    containerId,
    [
      "psql",
      "-U",
      pgUser,
      "-d",
      "postgres",
      "-Atc",
      "SELECT datname || '|' || pg_database_size(datname) FROM pg_database WHERE datistemplate=false AND datallowconn=true ORDER BY datname",
    ],
    { env: PG_DISCOVERY_ENV },
    server,
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Unable to list databases");
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, size] = line.split("|");
      return { name, sizeBytes: Number(size) || 0 };
    });
}

/**
 * Database list and server version in a single read-only psql call.
 */
export async function containerPgInfo(
  containerId: string,
  pgUser: string,
  server?: ServerRow | null,
): Promise<{ databases: Array<{ name: string; sizeBytes: number }>; version: string }> {
  const result = await execCapture(
    containerId,
    [
      "psql",
      "-U",
      pgUser,
      "-d",
      "postgres",
      "-Atc",
      "SELECT '#version|' || current_setting('server_version') " +
        "UNION ALL SELECT datname || '|' || pg_database_size(datname) FROM pg_database " +
        "WHERE datistemplate=false AND datallowconn=true",
    ],
    { env: PG_DISCOVERY_ENV },
    server,
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Unable to list databases");
  }
  let version = "";
  const databases: Array<{ name: string; sizeBytes: number }> = [];
  for (const raw of result.stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#version|")) {
      version = line.slice("#version|".length);
      continue;
    }
    const idx = line.lastIndexOf("|");
    databases.push({ name: line.slice(0, idx), sizeBytes: Number(line.slice(idx + 1)) || 0 });
  }
  databases.sort((a, b) => a.name.localeCompare(b.name));
  return { databases, version };
}

export async function postgresVersion(
  containerId: string,
  pgUser: string,
  server?: ServerRow | null,
): Promise<string> {
  const result = await execCapture(
    containerId,
    ["psql", "-U", pgUser, "-d", "postgres", "-Atc", "SHOW server_version"],
    { env: PG_DISCOVERY_ENV },
    server,
  );
  if (result.exitCode !== 0) return "";
  return result.stdout.trim();
}

export async function dockerVersion(
  server?: ServerRow | null,
): Promise<{ version: string; apiVersion: string }> {
  const info = await dockerClient(server).version();
  return { version: info.Version, apiVersion: info.ApiVersion };
}

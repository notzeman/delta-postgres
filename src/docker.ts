import Docker from "dockerode";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { Writable, Readable } from "stream";
import { config } from "./config";

export const docker = new Docker({ socketPath: config.dockerSocket });

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

export async function listAllContainers(): Promise<ContainerInfo[]> {
  const list = await docker.listContainers({ all: true });
  const infos: ContainerInfo[] = [];
  for (const item of list) {
    try {
      const info = await docker.getContainer(item.Id).inspect();
      infos.push(normalizeContainerInfo(info));
    } catch {
      /* container may have disappeared */
    }
  }
  return infos;
}

export async function getContainer(idOrName: string): Promise<ContainerInfo> {
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
): Promise<ExecResult> {
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
 * Run a command in a container and stream stdout to a file (binary safe).
 */
export async function execToFile(
  containerId: string,
  cmd: string[],
  destFile: string,
  onLine?: (line: string) => void,
  opts: { env?: string[]; user?: string } = {},
): Promise<ExecResult> {
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
  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  await new Promise<void>((resolve) => out.end(resolve));
  if (onLine && errBuf.trim()) onLine(errBuf);
  const info = await exec.inspect();
  return { exitCode: info.ExitCode ?? 1, stdout: "", stderr };
}

export async function copyFileToContainer(
  containerId: string,
  hostFile: string,
  destDir = "/tmp",
): Promise<string> {
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
): Promise<Array<{ name: string; sizeBytes: number }>> {
  const result = await execCapture(containerId, [
    "psql",
    "-U",
    pgUser,
    "-d",
    "postgres",
    "-Atc",
    "SELECT datname || '|' || pg_database_size(datname) FROM pg_database WHERE datistemplate=false AND datallowconn=true ORDER BY datname",
  ]);
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

export async function postgresVersion(
  containerId: string,
  pgUser: string,
): Promise<string> {
  const result = await execCapture(containerId, [
    "psql",
    "-U",
    pgUser,
    "-d",
    "postgres",
    "-Atc",
    "SHOW server_version",
  ]);
  if (result.exitCode !== 0) return "";
  return result.stdout.trim();
}

export async function dockerVersion(): Promise<{ version: string; apiVersion: string }> {
  const info = await docker.version();
  return { version: info.Version, apiVersion: info.ApiVersion };
}

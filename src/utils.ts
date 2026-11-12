import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  maxBuffer?: number;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const max = opts.maxBuffer ?? 8 * 1024 * 1024;
    let outBuf = "";
    let errBuf = "";

    const consume = (chunk: Buffer, stream: "stdout" | "stderr") => {
      const text = chunk.toString("utf8");
      if (stream === "stdout") stdout += text;
      else stderr += text;
      if (stdout.length + stderr.length > max) {
        stdout = stdout.slice(-max);
        stderr = stderr.slice(-max);
      }
      if (!opts.onLine) return;
      let buf = stream === "stdout" ? outBuf + text : errBuf + text;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || "";
      if (stream === "stdout") outBuf = buf;
      else errBuf = buf;
      for (const line of lines) {
        if (line.trim()) opts.onLine(line, stream);
      }
    };

    child.stdout?.on("data", (c: Buffer) => consume(c, "stdout"));
    child.stderr?.on("data", (c: Buffer) => consume(c, "stderr"));
    child.on("error", reject);
    child.on("close", (code) => {
      if (opts.onLine) {
        if (outBuf.trim()) opts.onLine(outBuf, "stdout");
        if (errBuf.trim()) opts.onLine(errBuf, "stderr");
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function spawnStream(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return spawn(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || `project-${Date.now().toString(36)}`;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function rmrf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function fileExists(file: string): boolean {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

export function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

const DIR_SIZE_TTL_MS = 60_000;
const dirSizeCache = new Map<string, { size: number; expiresAt: number }>();
const dirSizeInflight = new Map<string, Promise<number>>();

async function computeDirSize(dir: string): Promise<number> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (let index = 0; index < entries.length; index += 32) {
    const batch = entries.slice(index, index + 32);
    const sizes = await Promise.all(
      batch.map(async (entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return computeDirSize(full);
        if (entry.isFile()) {
          try {
            return (await fs.promises.stat(full)).size;
          } catch {
            return 0;
          }
        }
        return 0;
      }),
    );
    for (const size of sizes) total += size;
  }
  return total;
}

export async function dirSizeBytes(dir: string): Promise<number> {
  const cached = dirSizeCache.get(dir);
  if (cached && cached.expiresAt > Date.now()) return cached.size;
  const pending = dirSizeInflight.get(dir);
  if (pending) return pending;
  const promise = computeDirSize(dir)
    .then((size) => {
      dirSizeCache.set(dir, { size, expiresAt: Date.now() + DIR_SIZE_TTL_MS });
      return size;
    })
    .finally(() => {
      dirSizeInflight.delete(dir);
    });
  dirSizeInflight.set(dir, promise);
  return promise;
}

export function invalidateDirSize(dir: string): void {
  dirSizeCache.delete(dir);
}

export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function tailFile(file: string, maxLines = 500): string {
  try {
    const stat = fs.statSync(file);
    const readSize = Math.min(stat.size, 512 * 1024);
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const lines = buffer.toString("utf8").split(/\r?\n/);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}

export function parseJsonSafe<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

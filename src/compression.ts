/**
 * Compression for live "Take current snapshot" exports and archive downloads.
 *
 * Values are stored in pg_dump's own spec syntax so they can be handed to the
 * source container unchanged after validation:
 *
 *   none | gzip[:1-9] | lz4[:1-12] | zstd[:1-22]
 *
 * A project's `snapshot_compression` may be NULL, which means "inherit the
 * global default" (settings.defaultSnapshotCompression).
 */

import fs from "fs";
import { spawn } from "child_process";
import { constants as zlibConstants, createGzip, createZstdCompress } from "zlib";
import { pipeline } from "stream/promises";

export const SNAPSHOT_METHODS = ["none", "gzip", "lz4", "zstd"] as const;
export type SnapshotMethod = (typeof SNAPSHOT_METHODS)[number];
type CompressingMethod = Exclude<SnapshotMethod, "none">;

const LEVEL_RANGES: Record<CompressingMethod, [number, number]> = {
  gzip: [1, 9],
  lz4: [1, 12],
  zstd: [1, 22],
};

const DEFAULT_LEVELS: Record<CompressingMethod, number> = {
  gzip: 6,
  lz4: 1,
  zstd: 3,
};

export interface SnapshotCompression {
  method: SnapshotMethod;
  level?: number;
}

export function isSnapshotMethod(value: string): value is SnapshotMethod {
  return (SNAPSHOT_METHODS as readonly string[]).includes(value);
}

/**
 * Parse a stored snapshot compression spec. Returns null for anything that is
 * not a valid pg_dump method/level combination, so callers can reject bad input
 * instead of passing it to pg_dump.
 */
export function parseSnapshotCompression(
  spec: string | null | undefined,
): SnapshotCompression | null {
  const raw = String(spec ?? "").trim().toLowerCase();
  if (!raw) return null;
  const separator = raw.indexOf(":");
  const method = separator === -1 ? raw : raw.slice(0, separator);
  const levelPart = separator === -1 ? "" : raw.slice(separator + 1);
  if (!isSnapshotMethod(method)) return null;
  if (method === "none") return { method };
  if (!levelPart) return { method };
  const level = Number(levelPart);
  const [min, max] = LEVEL_RANGES[method];
  if (!Number.isInteger(level) || level < min || level > max) return null;
  return { method, level };
}

/** Canonical form: always includes the level for methods that use one. */
export function normalizeSnapshotCompression(
  spec: string | null | undefined,
): string | null {
  const parsed = parseSnapshotCompression(spec);
  if (!parsed) return null;
  if (parsed.method === "none") return "none";
  const level = parsed.level ?? DEFAULT_LEVELS[parsed.method];
  return `${parsed.method}:${level}`;
}

/**
 * Build the pg_dump arguments for a validated spec. `-Z` is used for
 * none/gzip so older pg_dump versions (< 16, which lack --compress) still
 * work; zstd/lz4 require PG 16+ and are passed as --compress=METHOD:LEVEL.
 */
export function snapshotCompressionArgs(spec: string | null | undefined): string[] {
  const parsed = parseSnapshotCompression(spec) ?? { method: "none" };
  if (parsed.method === "none") return ["-Z", "0"];
  const level = parsed.level ?? DEFAULT_LEVELS[parsed.method];
  if (parsed.method === "gzip") return ["-Z", String(level)];
  return [`--compress=${parsed.method}:${level}`];
}

/** Effective setting for a project: its own value, else the global default. */
export function resolveSnapshotCompression(
  projectValue: string | null | undefined,
  globalValue: string | null | undefined,
  configValue: string,
): string {
  return (
    normalizeSnapshotCompression(projectValue) ||
    normalizeSnapshotCompression(globalValue) ||
    normalizeSnapshotCompression(configValue) ||
    "none"
  );
}

/** File extension for a download, matching the compression method. */
export function snapshotCompressionExtension(spec: string | null | undefined): string {
  const method = parseSnapshotCompression(spec)?.method ?? "none";
  if (method === "none") return "";
  if (method === "gzip") return ".gz";
  if (method === "zstd") return ".zst";
  return ".lz4";
}

function compressWithLz4(input: string, output: string, level: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("lz4", ["-c", `-${level}`, "-q"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const closed = new Promise<number>((done) => child.on("close", (code) => done(code ?? 1)));
    child.on("error", (error) => {
      child.kill();
      reject(error);
    });
    Promise.all([
      pipeline(fs.createReadStream(input), child.stdin),
      pipeline(child.stdout, fs.createWriteStream(output)),
    ])
      .then(async () => {
        const code = await closed;
        if (code !== 0) throw new Error(stderr.trim() || `lz4 failed (${code})`);
        resolve();
      })
      .catch((error) => {
        child.kill();
        reject(error);
      });
  });
}

/**
 * Compress a dump file for download. Returns the canonical spec that was
 * applied. `none` never reaches this function (callers stream the file as-is).
 */
export async function compressSnapshotFile(
  input: string,
  output: string,
  spec: string | null | undefined,
): Promise<string> {
  const normalized = normalizeSnapshotCompression(spec);
  const parsed = parseSnapshotCompression(normalized);
  if (!normalized || !parsed || parsed.method === "none") {
    throw new Error("A compression method other than none is required");
  }
  const level = parsed.level ?? DEFAULT_LEVELS[parsed.method];
  if (parsed.method === "lz4") {
    await compressWithLz4(input, output, level);
  } else {
    const compressor =
      parsed.method === "gzip"
        ? createGzip({ level })
        : createZstdCompress({
            params: { [zlibConstants.ZSTD_c_compressionLevel]: level },
          });
    await pipeline(fs.createReadStream(input), compressor, fs.createWriteStream(output));
  }
  return normalized;
}

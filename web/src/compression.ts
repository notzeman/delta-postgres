export const COMPRESSION_MECHANISMS = [
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

export function compressionSupportsLevel(mechanism: string): boolean {
  return (
    mechanism === "auto,zstd" ||
    mechanism === "zstd" ||
    mechanism === "zlib" ||
    mechanism === "lzma"
  );
}

export function parseCompression(spec: string): { mechanism: string; level: string } {
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

export function buildCompression(mechanism: string, level: string): string {
  if (!compressionSupportsLevel(mechanism)) return mechanism;
  return `${mechanism},${level || "3"}`;
}

/**
 * "Take current snapshot" compression. Stored in pg_dump spec syntax
 * (`none`, `gzip:6`, `lz4:1`, `zstd:3`) and applied to the live download only;
 * Borg uses the separate mechanism above.
 */
export const SNAPSHOT_COMPRESSION_METHODS = [
  {
    value: "none",
    label: "none",
    description: "No compression · largest download, restores anywhere",
  },
  {
    value: "gzip",
    label: "gzip",
    description: "Balanced · restores with any pg_restore",
  },
  { value: "lz4", label: "lz4", description: "Fast · larger than zstd" },
  {
    value: "zstd",
    label: "zstd",
    description: "Smallest · needs pg_restore 16 or newer",
  },
];

const SNAPSHOT_LEVEL_RANGES: Record<string, [number, number]> = {
  gzip: [1, 9],
  lz4: [1, 12],
  zstd: [1, 22],
};

const SNAPSHOT_DEFAULT_LEVELS: Record<string, number> = {
  gzip: 6,
  lz4: 1,
  zstd: 3,
};

export function snapshotSupportsLevel(mechanism: string): boolean {
  return mechanism in SNAPSHOT_LEVEL_RANGES;
}

export function snapshotLevelOptions(mechanism: string): string[] {
  const range = SNAPSHOT_LEVEL_RANGES[mechanism];
  if (!range) return [];
  return Array.from({ length: range[1] - range[0] + 1 }, (_, index) =>
    String(range[0] + index),
  );
}

export function defaultSnapshotLevel(mechanism: string): string {
  return String(SNAPSHOT_DEFAULT_LEVELS[mechanism] ?? "");
}

export function parseSnapshotCompression(spec: string): {
  mechanism: string;
  level: string;
} {
  const raw = (spec || "").trim().toLowerCase();
  if (!raw) return { mechanism: "none", level: "" };
  const separator = raw.indexOf(":");
  const mechanism = separator === -1 ? raw : raw.slice(0, separator);
  const level = separator === -1 ? "" : raw.slice(separator + 1);
  if (!SNAPSHOT_COMPRESSION_METHODS.some((option) => option.value === mechanism)) {
    return { mechanism: "none", level: "" };
  }
  return { mechanism, level };
}

export function buildSnapshotCompression(mechanism: string, level: string): string {
  if (!snapshotSupportsLevel(mechanism)) return mechanism;
  return `${mechanism}:${level || defaultSnapshotLevel(mechanism)}`;
}

export function snapshotCompressionLabel(spec: string): string {
  const { mechanism, level } = parseSnapshotCompression(spec);
  return snapshotSupportsLevel(mechanism) && level
    ? `${mechanism} level ${level}`
    : mechanism;
}

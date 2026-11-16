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

import React from "react";
import { cn } from "./ui";

/**
 * A row of chunks representing logical dump bytes. Amber chunks are the share
 * Borg actually had to store (new deduplicated data); the rest were already in
 * the repository. Stored chunks are spread evenly, like changed blocks in a dump.
 */
export default function ChunkStrip({
  logical,
  stored,
  count = 48,
  className,
}: {
  logical: number;
  stored: number;
  count?: number;
  className?: string;
}) {
  const ratio = logical > 0 ? Math.min(Math.max(stored / logical, 0), 1) : 0;
  const storedCount = logical > 0 ? Math.max(1, Math.round(ratio * count)) : 0;
  const isStored = (index: number) =>
    storedCount > 0 &&
    Math.floor(((index + 1) * storedCount) / count) > Math.floor((index * storedCount) / count);

  return (
    <div
      className={cn("grid gap-1", className)}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      role="img"
      aria-label={
        logical > 0
          ? `${storedCount} of ${count} chunks stored as new data`
          : "No archives yet"
      }
    >
      {Array.from({ length: count }).map((_, index) => (
        <span
          key={index}
          className={cn(
            "h-7 rounded-md sm:h-8",
            logical === 0
              ? "bg-white/[0.06]"
              : isStored(index)
                ? "bg-delta-400"
                : "hatch",
          )}
        />
      ))}
    </div>
  );
}
